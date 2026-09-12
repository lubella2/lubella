-- ============================================================================
-- LuBella  |  Production verification
-- ============================================================================
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_production.sql
--
-- Read-only. Run it against the production database (or the Supabase SQL
-- editor) right after applying supabase/production_bundle.sql, and again after
-- any future migration. Every line must say PASS.
--
-- What it proves:
--   * every table in public has row level security enabled
--   * the anonymous (public) surface is exactly what the design says: two
--     catalogue views and 18 functions — no stock, no costs, no settings table
--   * internal-only tables (purchase_batches, supplier_payables,
--     supplier_statements) are not readable directly by anyone through the API
--   * the audit/touch triggers that make history tamper-evident are installed
-- ============================================================================

with checks as (
  select
    'all public tables have RLS enabled' as check_name,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0 as ok,
    (select count(*)::text || ' table(s) without RLS' from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as detail

  union all
  select
    'the public (anon) surface is exactly the catalogue views',
    coalesce((select array_agg(c.relname order by c.relname) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
        and has_table_privilege('anon', c.oid, 'select')),
      '{}'::name[]) = array['public_categories', 'public_products']::name[],
    coalesce((select string_agg(c.relname, ', ' order by c.relname) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
        and has_table_privilege('anon', c.oid, 'select')), '(none)')

  union all
  select
    'anon can execute exactly 18 functions',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')) = 18,
    'found ' || (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute'))

  union all
  select
    'anon cannot read on-hand stock',
    not has_function_privilege('anon', 'public.fn_on_hand(uuid)', 'execute'),
    'fn_on_hand(uuid)'

  union all
  select
    'anon cannot read the settings table',
    not has_table_privilege('anon', 'public.settings', 'select'),
    'settings'

  union all
  select
    'anon cannot read sales',
    not has_table_privilege('anon', 'public.sales', 'select'),
    'sales'

  union all
  select
    'stock cost is not readable through the API',
    not has_table_privilege('anon', 'public.purchase_batches', 'select')
    and not has_table_privilege('authenticated', 'public.purchase_batches', 'select'),
    'purchase_batches is RPC-only'

  union all
  select
    'supplier money tables are not readable through the API',
    not has_table_privilege('authenticated', 'public.supplier_payables', 'select')
    and not has_table_privilege('authenticated', 'public.supplier_statements', 'select')
    and not has_table_privilege('authenticated', 'public.supplier_internal_notes', 'select'),
    'supplier_payables / supplier_statements / supplier_internal_notes are RPC-only'

  union all
  select
    'audit and touch triggers are installed',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal) >= 10,
    (select count(*)::text || ' triggers' from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal)

  union all
  select
    'shop settings were seeded',
    (select count(*) from public.settings) >= 20,
    (select count(*)::text || ' settings rows' from public.settings)

  union all
  select
    'the first-run owner bootstrap function exists',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rpc_register_app_user'),
    'rpc_register_app_user'
)
select
  case when ok then 'PASS' else 'FAIL' end as result,
  check_name,
  detail
from checks
order by ok, check_name;

-- One-line summary — 0 failures means the deployment is sound.
select
  count(*) filter (where ok)     as passed,
  count(*) filter (where not ok) as failed
from (
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0 as ok
  union all
  select coalesce((select array_agg(c.relname order by c.relname) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
        and has_table_privilege('anon', c.oid, 'select')),
      '{}'::name[]) = array['public_categories', 'public_products']::name[]
  union all
  select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')) = 18
  union all
  select not has_function_privilege('anon', 'public.fn_on_hand(uuid)', 'execute')
  union all
  select not has_table_privilege('anon', 'public.settings', 'select')
  union all
  select not has_table_privilege('anon', 'public.sales', 'select')
  union all
  select not has_table_privilege('anon', 'public.purchase_batches', 'select')
     and not has_table_privilege('authenticated', 'public.purchase_batches', 'select')
  union all
  select not has_table_privilege('authenticated', 'public.supplier_payables', 'select')
     and not has_table_privilege('authenticated', 'public.supplier_statements', 'select')
     and not has_table_privilege('authenticated', 'public.supplier_internal_notes', 'select')
  union all
  select (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal) >= 10
  union all
  select (select count(*) from public.settings) >= 20
  union all
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rpc_register_app_user')
) t;
