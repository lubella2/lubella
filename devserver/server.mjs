/**
 * ============================================================================
 * LuBella  |  LOCAL DEVELOPMENT GATEWAY   (not part of the production deploy)
 * ============================================================================
 * Implements the small slice of the Supabase API that the app actually uses —
 * GoTrue auth, a PostgREST query subset, Storage objects, and one Edge
 * Function — directly on top of PostgreSQL.
 *
 * Why this exists: the app talks to Supabase through @supabase/supabase-js. In
 * production that means hosted Supabase; locally it means this file. Crucially,
 * every request is executed as a real PostgreSQL role with the caller's JWT
 * claims:
 *
 *     begin;
 *     set local role authenticated;               -- or anon
 *     set local request.jwt.claims = '{"sub":…}';
 *     <the query>
 *     commit;
 *
 * so Row Level Security, the table privileges and the SECURITY DEFINER RPC
 * guards are all genuinely in force. The client code path is identical in both
 * environments — this is not a mock.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 54321);
const JWT_SECRET = process.env.JWT_SECRET || 'lubella-dev-jwt-secret-not-for-production';
const SERVICE_KEY = process.env.SERVICE_KEY || 'lubella-dev-service-role-key';
const ANON_KEY = process.env.ANON_KEY || 'lubella-dev-anon-key';
const DB_URL = process.env.DATABASE_URL || 'postgres://user:user@localhost:5432/lubella';
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, 'storage');

const pool = new pg.Pool({ connectionString: DB_URL, max: 10 });
fs.mkdirSync(STORAGE_ROOT, { recursive: true });

/* ---------------------------------------------------------------------------
 * JWT (HS256) — same shape Supabase issues, so the client is unchanged.
 * -------------------------------------------------------------------------*/
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function signToken(payload) {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [h, p, s] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * PostgREST query-subset parser
 *   ?select=a,b   ?col=eq.v   ?col=neq.v   ?col=is.null   ?col=in.(a,b)
 *   ?order=col.desc?nullslast   ?limit=20   ?offset=5
 * Comparison operators are only ever applied to quoted identifiers, so the
 * generated SQL cannot be influenced by anything except the filter value, which
 * is always passed as a bind parameter.
 * -------------------------------------------------------------------------*/
const IDENT = /^[a-z_][a-z0-9_]*$/i;

function parseQuery(searchParams) {
  const filters = [];
  const params = [];
  let select = '*';
  let order = '';
  let limit = '';
  let offset = '';

  for (const [rawKey, value] of searchParams.entries()) {
    const key = rawKey;
    if (key === 'select') { select = value; continue; }
    if (key === 'order') {
      order = value.split(',').map((part) => {
        const [col, ...mods] = part.split('.');
        if (!IDENT.test(col)) throw new HttpError(400, `bad order column: ${col}`);
        const dir = mods.includes('desc') ? 'desc' : 'asc';
        const nulls = mods.includes('nullslast') ? ' nulls last'
                    : mods.includes('nullsfirst') ? ' nulls first' : '';
        return `"${col}" ${dir}${nulls}`;
      }).join(', ');
      continue;
    }
    if (key === 'limit') { limit = ` limit ${Number(value) || 0}`; continue; }
    if (key === 'offset') { offset = ` offset ${Number(value) || 0}`; continue; }
    if (key === 'on_conflict' || key === 'columns') continue;

    if (!IDENT.test(key)) throw new HttpError(400, `bad filter column: ${key}`);
    const dot = value.indexOf('.');
    if (dot < 0) throw new HttpError(400, `bad filter: ${value}`);
    const op = value.slice(0, dot);
    const operand = value.slice(dot + 1);

    if (op === 'eq')  { params.push(operand === 'null' ? null : operand); filters.push(`"${key}" is not distinct from $${params.length}`); }
    else if (op === 'neq') { params.push(operand); filters.push(`"${key}" is distinct from $${params.length}`); }
    else if (op === 'gt')  { params.push(operand); filters.push(`"${key}" > $${params.length}`); }
    else if (op === 'gte') { params.push(operand); filters.push(`"${key}" >= $${params.length}`); }
    else if (op === 'lt')  { params.push(operand); filters.push(`"${key}" < $${params.length}`); }
    else if (op === 'lte') { params.push(operand); filters.push(`"${key}" <= $${params.length}`); }
    else if (op === 'is')  { filters.push(`"${key}" is ${operand.toUpperCase() === 'NULL' ? 'null' : operand}`); }
    else if (op === 'in')  {
      const list = operand.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      const placeholders = list.map((v) => { params.push(v); return `$${params.length}`; });
      filters.push(`"${key}" in (${placeholders.join(', ')})`);
    }
    else if (op === 'ilike') { params.push(operand); filters.push(`"${key}" ilike $${params.length}`); }
    else throw new HttpError(400, `unsupported operator: ${op}`);
  }

  const cols = select === '*'
    ? '*'
    : select.split(',').map((c) => {
        const col = c.trim();
        // embedded resources are not supported: the app uses views/RPCs instead
        if (!IDENT.test(col)) throw new HttpError(400, `bad select column: ${col}`);
        return `"${col}"`;
      }).join(', ');

  return { cols, where: filters.length ? ` where ${filters.join(' and ')}` : '', order, limit, offset, params };
}

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/* ---------------------------------------------------------------------------
 * Bind a JSON value as a SQL parameter.
 *
 * PostgREST hands objects and arrays to jsonb parameters as JSON text. A raw JS
 * array would be sent as a Postgres array literal instead, which fails to cast
 * to jsonb — so anything composite is stringified here.
 * ------------------------------------------------------------------------- */
function toPgValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return value;
}

/* ---------------------------------------------------------------------------
 * Run a statement as a specific PostgreSQL role with the caller's claims.
 * -------------------------------------------------------------------------*/
async function runAs({ role, claims, text, values = [], single = false }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
    const result = await client.query(text, values);
    await client.query('commit');
    if (single) {
      if (result.rows.length === 0) throw new HttpError(406, 'JSON object requested, multiple (or no) rows returned');
      return result.rows[0];
    }
    return result.rows;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

function pgErrorToHttp(err) {
  const code = err.code || '';
  const status =
    code === '42501' ? 403 :          // insufficient_privilege (RLS / grants / our guards)
    code === '23514' ? 400 :          // check violation (business rule)
    code === '23505' ? 409 :          // unique violation
    code === '23503' ? 409 :          // foreign key
    code === 'P0001' ? 400 :          // raise_exception from the RPC guards
    code === '42883' ? 404 :          // function does not exist (wrong arguments)
    code === '22023' ? 400 :          // invalid parameter value
    500;
  return new HttpError(status, err.message, { code, detail: err.detail, hint: err.hint });
}

/* ---------------------------------------------------------------------------
 * Edge-function shim: the same job the Supabase Edge Function does in
 * production — verify the caller is an owner, create the auth user with the
 * service key, then register the profile through the owner-only RPC.
 * -------------------------------------------------------------------------*/
async function handleAdminCreateUser(body, claims) {
  const { email, password, fullName, role, phone, commissionRate } = body;
  if (!email || !password || !fullName || !role) {
    throw new HttpError(400, 'email, password, fullName and role are required');
  }
  // the caller must genuinely be an owner, checked against the database
  const [ownerCheck] = await runAs({
    role: 'authenticated', claims,
    text: 'select public.fn_is_owner() as is_owner',
  });
  if (!ownerCheck?.is_owner) throw new HttpError(403, 'OWNER_ONLY: only the shop owner may create accounts');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `select auth.create_user($1, $2, jsonb_build_object('full_name', $3::text)) as id`,
      [email, password, fullName],
    );
    const userId = rows[0].id;
    await client.query('commit');

    // profile row is created through the normal owner-guarded RPC
    const [created] = await runAs({
      role: 'authenticated', claims,
      text: `select public.rpc_register_app_user($1::uuid, $2, $3, $4::public.user_role, $5, $6) as result`,
      values: [userId, email, fullName, role, phone || null, commissionRate ?? 0.03],
      single: true,
    });
    return { userId, profile: created?.result };
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw pgErrorToHttp(err);
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------------------------
 * HTTP
 * -------------------------------------------------------------------------*/
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'content-range, x-total-count',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  };
  const send = (status, payload, extraHeaders = {}) => {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors, ...extraHeaders });
    res.end(body);
  };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  const readBody = () => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const claims = token ? (verifyToken(token) || {}) : {};
    const isService = token === SERVICE_KEY || claims.role === 'service_role';
    const role = isService ? 'service_role' : (claims.sub ? 'authenticated' : 'anon');
    const single = (req.headers.accept || '').includes('vnd.pgrst.object');

    /* ---------------- Auth ---------------- */
    if (url.pathname === '/auth/v1/token') {
      const raw = await readBody();
      const body = JSON.parse(raw.toString() || '{}');
      const grant = url.searchParams.get('grant_type');

      if (grant === 'refresh_token') {
        const payload = verifyToken(body.refresh_token || '');
        if (!payload?.sub) return send(400, { error: 'invalid_grant', error_description: 'refresh token is not valid' });
        const access = signToken({ sub: payload.sub, role: 'authenticated', email: payload.email, exp: Math.floor(Date.now() / 1000) + 3600 });
        return send(200, {
          access_token: access, token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: signToken({ sub: payload.sub, email: payload.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }),
          user: { id: payload.sub, email: payload.email, aud: 'authenticated', role: 'authenticated' },
        });
      }

      const { rows: found } = await pool.query(
        `select u.id, u.email, a.full_name, a.role,
                auth.verify_password($1, $2) as verified_id
           from auth.users u left join public.app_users a on a.id = u.id
          where u.email = lower($1)`,
        [body.email || '', body.password || ''],
      );
      const user = found[0];
      if (!user || !user.verified_id) {
        return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      if (!user.role) {
        return send(400, { error: 'invalid_grant', error_description: 'This login is not linked to a LuBella profile yet.' });
      }
      const access = signToken({ sub: user.id, role: 'authenticated', email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 });
      return send(200, {
        access_token: access, token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: signToken({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }),
        user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated',
                app_metadata: { provider: 'email', lubella_role: user.role },
                user_metadata: { full_name: user.full_name } },
      });
    }

    if (url.pathname === '/auth/v1/logout') return send(204, undefined);

    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      if (!claims.sub) return send(401, { message: 'not authenticated' });
      const [profile] = await runAs({ role: 'authenticated', claims, text: 'select * from public.fn_current_user_row()' });
      return send(200, { id: claims.sub, email: claims.email, aud: 'authenticated', role: 'authenticated',
                         user_metadata: { full_name: profile?.full_name }, app_metadata: { lubella_role: profile?.role } });
    }

    /* ---------------- Edge function ---------------- */
    if (url.pathname === '/functions/v1/admin-create-user' && req.method === 'POST') {
      const body = JSON.parse((await readBody()).toString() || '{}');
      return send(200, await handleAdminCreateUser(body, claims));
    }

    /* ---------------- Storage ---------------- */
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const key = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
      const filePath = path.join(STORAGE_ROOT, key.replace(/\.\./g, ''));
      if (req.method === 'PUT' || req.method === 'POST') {
        const raw = await readBody();
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, raw);
        return send(200, { Key: key });
      }
      if (req.method === 'GET') {
        if (!fs.existsSync(filePath)) return send(404, { message: 'Object not found' });
        const ext = path.extname(filePath).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp'
                   : ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                   : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=300', ...cors });
        return res.end(fs.readFileSync(filePath));
      }
    }

    /* ---------------- RPC ---------------- */
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.replace('/rest/v1/rpc/', '');
      if (!IDENT.test(fn)) return send(400, { message: 'bad function name' });
      const raw = await readBody();
      const args = raw.length ? JSON.parse(raw.toString()) : {};

      let sql;
      let values = [];
      if (Object.keys(args).length === 0) {
        sql = `select public."${fn}"() as result`;
      } else {
        // Named-argument JSON, exactly as PostgREST accepts it. Objects and
        // arrays are passed as JSON text: node-postgres would otherwise render
        // a JS array as a Postgres array literal, which a jsonb parameter
        // cannot accept.
        const keys = Object.keys(args).filter((k) => args[k] !== undefined);
        values = keys.map((k) => toPgValue(args[k]));
        const named = keys.map((k, i) => `"${k}" => $${i + 1}`).join(', ');
        sql = `select public."${fn}"(${named}) as result`;
      }

      try {
        const rows = await runAs({ role, claims, text: sql, values, single: false });
        const result = rows[0]?.result;
        if (single) return send(200, result === null || result === undefined ? null : result);
        return send(200, single ? result : result);
      } catch (err) {
        throw pgErrorToHttp(err);
      }
    }

    /* ---------------- Table reads ---------------- */
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.replace('/rest/v1/', '');
      if (!IDENT.test(table)) return send(400, { message: 'bad table name' });
      const { cols, where, order, limit, offset, params } = parseQuery(url.searchParams);
      const sql = `select ${cols} from public."${table}"${where}${order ? ` order by ${order}` : ''}${limit}${offset}`;

      try {
        if (req.method === 'GET') {
          const rows = await runAs({ role, claims, text: sql, values: params, single });
          if (single) return send(200, rows);
          return send(200, rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
        }
        // Writes: no route grants INSERT/UPDATE/DELETE to any client role, and
        // RLS has no permissive policy for them, so the database refuses. This
        // exists so the app gets a clear error rather than a silent no-op.
        const raw = await readBody();
        if (!raw.length) return send(400, { message: 'no data supplied' });
        const body = JSON.parse(raw.toString());
        const keys = Object.keys(body);
        if (req.method === 'POST') {
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const sqlInsert = `insert into public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) values (${placeholders}) returning *`;
          const rows = await runAs({ role, claims, text: sqlInsert, values: keys.map((k) => toPgValue(body[k])), single });
          return send(201, single ? rows : [rows]);
        }
        if (req.method === 'PATCH') {
          const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
          const sqlUpdate = `update public."${table}" set ${sets}${where} returning *`;
          const rows = await runAs({ role, claims, text: sqlUpdate, values: [...keys.map((k) => toPgValue(body[k])), ...params], single });
          return send(200, single ? rows : [rows]);
        }
        if (req.method === 'DELETE') {
          const rows = await runAs({ role, claims, text: `delete from public."${table}"${where} returning *`, values: params });
          return send(200, rows);
        }
      } catch (err) {
        throw pgErrorToHttp(err);
      }
    }

    /* ---------------- health ---------------- */
    if (url.pathname === '/health') {
      const { rows } = await pool.query('select count(*)::int as products from public.products');
      return send(200, { ok: true, products: rows[0].products, gateway: 'lubella-dev' });
    }

    return send(404, { message: `no route for ${req.method} ${url.pathname}` });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    // A 500 means a bug in the gateway rather than a database rule firing, so it
    // is logged loudly instead of being swallowed.
    if (status === 500) console.error('[gateway]', err);
    return send(status, {
      message: err.message || 'unexpected error',
      ...(err.extra || {}),
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LuBella dev gateway listening on http://0.0.0.0:${PORT}`);
  console.log(`  anon key:    ${ANON_KEY}`);
  console.log(`  service key: ${SERVICE_KEY}`);
});
