/**
 * Supabase Edge Function — admin-create-user
 *
 * Creating an account needs the service-role key, which must never reach a
 * browser. This function is the only place the shop uses it, and it does three
 * things in order:
 *
 *   1. identifies the caller from their JWT,
 *   2. asks the database whether that caller is really the owner
 *      (`fn_is_owner()` — the same guard every owner RPC uses),
 *   3. only then creates the auth user and registers the profile.
 *
 * A staff or supplier token that calls this directly is refused before any user
 * is created. The profile row itself is written through the owner-guarded RPC
 * `rpc_register_app_user`, so the rules stay in one place.
 *
 * Deploy:
 *   supabase functions deploy admin-create-user
 * Secrets it needs (set once, server-side only):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ message: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    return json({ message: 'SERVER_MISCONFIGURED: Supabase secrets are not set' }, 500);
  }

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json({ message: 'NOT_SIGNED_IN: sign in first' }, 401);
  }

  // The caller's own client — used only to ask who they are and whether the
  // database considers them the owner. It cannot bypass RLS.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json({ message: 'NOT_SIGNED_IN: the session is not valid' }, 401);
  }

  // The authoritative check: run the same function every owner RPC uses.
  const { data: isOwner, error: ownerError } = await asCaller.rpc('fn_is_owner');
  if (ownerError) return json({ message: ownerError.message }, 400);
  if (isOwner !== true) {
    return json({ message: 'OWNER_ONLY: only the shop owner may create accounts' }, 403);
  }

  let body: {
    email?: string; password?: string; fullName?: string;
    role?: 'OWNER' | 'STAFF' | 'SUPPLIER'; phone?: string | null; commissionRate?: number;
  };
  try {
    body = await req.json();
  } catch {
    return json({ message: 'the request body must be JSON' }, 400);
  }

  const { email, password, fullName, role, phone, commissionRate } = body;
  if (!email || !password || !fullName || !role) {
    return json({ message: 'email, password, fullName and role are required' }, 400);
  }
  if (!['OWNER', 'STAFF', 'SUPPLIER'].includes(role)) {
    return json({ message: `unknown role: ${role}` }, 400);
  }
  if (password.length < 8) {
    return json({ message: 'The password must be at least 8 characters.' }, 400);
  }

  // Service role: creates the auth user. Never exposed to the browser.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created?.user) {
    const status = createError?.message?.toLowerCase().includes('already') ? 409 : 400;
    return json({ message: createError?.message ?? 'the account could not be created' }, status);
  }

  // Profile row through the owner-guarded RPC, so the same rules apply as if
  // the owner had created it from the interface.
  const { data: profile, error: profileError } = await asCaller.rpc('rpc_register_app_user', {
    p_user_id: created.user.id,
    p_email: email.trim().toLowerCase(),
    p_full_name: fullName,
    p_role: role,
    p_phone: phone || null,
    p_commission_rate: commissionRate ?? 0.03,
  });

  if (profileError) {
    // Leave no half-created account behind: the auth user goes too.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return json({ message: profileError.message }, 400);
  }

  return json({ userId: created.user.id, profile }, 201);
});
