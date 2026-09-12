-- ============================================================================
-- LuBella  |  Migration 9999 — API surface grants  (single source of truth)
-- ============================================================================
-- WHY THIS FILE IS NUMBERED 9999 AND MUST STAY THE LAST MIGRATION:
--   Every migration after the one that revokes privileges would otherwise
--   re-introduce the exposure, because CREATE FUNCTION grants EXECUTE to PUBLIC
--   by default. Migration 0019 proved this in practice: its two new functions
--   were briefly callable by `anon` until this file ran again.
--   If a future migration adds functions, it must be numbered below 9999, and
--   the security test asserting the anonymous surface honours this list is the
--   tripwire that catches any drift.
--
-- Why this file exists separately and runs last:
--   CREATE FUNCTION grants EXECUTE to PUBLIC by default, and that default is
--   re-applied to every function created AFTER the blanket revoke in 0010.
--   So the revoke has to happen again once all functions exist, and only then
--   is the intended surface opened. Every EXECUTE grant in the project lives
--   here, so there is exactly one list to audit.
--
-- The grants are generated from the catalog rather than typed out, which means
-- a signature change can never silently leave a function ungranted (or, worse,
-- granted to the wrong audience).
-- ============================================================================

-- Step 1: close everything again — including the helper grants from 0010 and
-- anything inherited by functions created in 0011-0017.
revoke all on all functions in schema public from public, anon, authenticated;

-- Step 2: helpers that must be executable by the caller, because RLS policy
-- expressions and definer views are evaluated with the caller's privileges.
-- Each of these reveals only information the caller already owns (their own
-- role, their own supplier id, or a pure formatting/maths helper).
grant execute on function public.fn_is_owner()            to anon, authenticated;
grant execute on function public.fn_is_staff()            to anon, authenticated;
grant execute on function public.fn_is_internal()         to anon, authenticated;
grant execute on function public.fn_is_supplier()         to anon, authenticated;
grant execute on function public.fn_current_supplier_id() to anon, authenticated;
grant execute on function public.fn_current_user_row()    to authenticated;
grant execute on function public.fn_money(numeric)        to anon, authenticated;
grant execute on function public.fn_availability(int, int) to anon, authenticated;
grant execute on function public.fn_expiry_status(date, int) to anon, authenticated;
grant execute on function public.fn_urlencode(text)       to anon, authenticated;
grant execute on function public.fn_public_settings()     to anon, authenticated;
-- Audience-guarded wrappers used by the views. Each returns only what its
-- audience is entitled to; the raw primitives (fn_on_hand, fn_avg_unit_cost,
-- fn_setting) are deliberately NOT granted to anyone.
grant execute on function public.fn_public_setting(text, jsonb)  to anon, authenticated;
grant execute on function public.fn_public_availability(uuid, int) to anon, authenticated;
grant execute on function public.fn_staff_on_hand(uuid)          to authenticated;
grant execute on function public.fn_contact_links(text)   to anon, authenticated;
grant execute on function public.fn_build_order_message(jsonb, numeric, text, text, text) to anon, authenticated;

-- Step 3: the RPC API. Public = safe for anonymous customers; everything else is
-- granted to `authenticated` only, and each of those functions re-checks the
-- caller's role internally (fn_require_owner / fn_require_internal), so a staff
-- or supplier token calling an owner RPC is rejected inside the database.
do $$
declare
  f record;
  v_public_api text[] := array[
    'rpc_public_catalog',
    'rpc_public_filters',
    'rpc_build_order_message',
    'rpc_submit_customer_request'
  ];
begin
  for f in
    select p.oid::regprocedure as signature, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'rpc\_%'
    order by p.proname
  loop
    if f.proname = any (v_public_api) then
      execute format('grant execute on function %s to anon, authenticated', f.signature);
    else
      execute format('grant execute on function %s to authenticated', f.signature);
    end if;
  end loop;
end $$;

-- Step 4: sequences. Only the definer functions touch them.
do $$
declare r record;
begin
  for r in select sequence_name from information_schema.sequences where sequence_schema = 'public'
  loop
    execute format('revoke all on sequence public.%I from anon, authenticated', r.sequence_name);
  end loop;
end $$;

-- -- Verification helper (owner-only) -----------------------------------------
-- Lists the API surface actually reachable by each client role, so the grant
-- list can be inspected from the Audit area rather than assumed.
create or replace function public.rpc_api_surface()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.fn_is_owner() then jsonb_build_object(
    'anon', coalesce((select jsonb_agg(p.proname order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')), '[]'::jsonb),
    'authenticated', coalesce((select jsonb_agg(p.proname order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')), '[]'::jsonb)
  ) else '{}'::jsonb end;
$$;

revoke all on function public.rpc_api_surface() from public, anon, authenticated;
grant execute on function public.rpc_api_surface() to authenticated;
