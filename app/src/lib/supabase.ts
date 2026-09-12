import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client.
 *
 * Only the ANON key ever reaches the browser. Service-role keys, the Telegram
 * bot token and any other credential live in the database (and in server-side
 * environment variables) and are never bundled — see docs/00-ARCHITECTURE.md §4.
 *
 * In development the app talks to a same-origin `/api` proxy in front of the
 * local gateway, so the browser never needs to reach another host (which matters
 * for previews served from a sandbox origin).
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || `${window.location.origin}/api`;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || 'lubella-dev-anon-key';

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'lubella.auth',
  },
  global: {
    headers: { 'x-application-name': 'lubella-app' },
  },
});

export const isDevGateway = url.includes('/api') || url.includes('127.0.0.1:54321');

/**
 * Every error that reaches the UI is normalised here, so pages can render a
 * helpful message instead of "{}". Database guard messages (OWNER_ONLY,
 * PERIOD_CLOSED, INSUFFICIENT_STOCK…) are intentionally surfaced verbatim —
 * they are written to be read by shop staff, not developers.
 */
export class ApiError extends Error {
  code?: string;
  status?: number;
  payload?: unknown;

  constructor(message: string, opts: { code?: string; status?: number; payload?: unknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.payload = opts.payload;
  }

  /** True when PostgreSQL refused the action because of the caller's role. */
  get isPermissionError(): boolean {
    return this.code === '42501' || /ONLY:|permission denied/i.test(this.message);
  }
}

function normalise(error: unknown, status?: number): ApiError {
  if (error instanceof ApiError) return error;
  const e = error as { message?: string; code?: string; details?: string; hint?: string };
  const message = e?.message || 'Something went wrong. Please try again.';
  return new ApiError(message, { code: e?.code, status, payload: error });
}

/** Calls a PostgreSQL function. All money mutations go through here. */
export async function rpc<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw normalise(error);
  return data as T;
}

/** Reads a table or view (RLS-filtered rows only). */
export async function select<T = unknown>(
  table: string,
  options: {
    columns?: string;
    filters?: Record<string, string | number | boolean | null>;
    order?: string;
    limit?: number;
  } = {},
): Promise<T[]> {
  let query = supabase.from(table).select(options.columns || '*');
  for (const [key, value] of Object.entries(options.filters || {})) {
    if (value === null) query = query.is(key, null);
    else query = query.eq(key, value);
  }
  if (options.order) {
    const [col, dir] = options.order.split('.');
    query = query.order(col, { ascending: dir !== 'desc' });
  }
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) {
    // A missing grant or a blocked RLS read is a permission outcome, not a bug.
    if (error.code === '42501' || /permission denied/i.test(error.message || '')) {
      throw new ApiError('Your account does not have access to this information.', {
        code: error.code,
        payload: error,
      });
    }
    throw normalise(error);
  }
  return (data || []) as T[];
}
