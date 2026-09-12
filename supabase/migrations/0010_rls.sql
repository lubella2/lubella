-- ============================================================================
-- LuBella  |  Migration 0010 — Row Level Security + privileges
-- ============================================================================
-- Strategy: DEFAULT DENY, EXPLICIT ALLOW.
--
--   1. RLS is enabled on every table in `public`.
--   2. Every privilege is revoked from anon/authenticated on every table, view
--      and function — this undoes Supabase's permissive default grants, so a
--      table that nobody thought about ends up invisible rather than exposed.
--   3. Specific grants are handed back to `anon` (catalog + request RPC) and
--      `authenticated` (RLS-scoped reads + RPCs).
--   4. Policies then filter rows by role.
--
-- The result: staff cannot retrieve cost, COGS, payable or valuation data with
-- browser devtools or a raw REST call — the database refuses the request.
-- Supplier A cannot retrieve Supplier B's rows. Customers can reach only the
-- curated public catalog.
-- ============================================================================

-- Roles exist on Supabase; created here so the migrations are portable.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Step 1 & 2: enable RLS everywhere, then strip every default privilege.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
  loop
    if r.relkind in ('r','p') then
      execute format('alter table public.%I enable row level security', r.relname);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;

  -- Sequences: identity/serial access is only ever needed by definer functions.
  for r in select sequence_name from information_schema.sequences where sequence_schema = 'public'
  loop
    execute format('revoke all on sequence public.%I from anon, authenticated', r.sequence_name);
  end loop;
end $$;

-- Functions default to EXECUTE for PUBLIC, and — importantly — a function
-- created LATER inherits that default again. The blanket revoke below closes it
-- for everything defined so far; 0018_api_grants.sql repeats the revoke after
-- the RPCs exist and then opens only the intended API surface. All function
-- grants live in 0018 so there is exactly one place to audit them.
revoke all on all functions in schema public from public, anon, authenticated;

-- ===========================================================================
-- GRANTS — anon (public customer portal)
-- ===========================================================================
grant select on public.public_products   to anon, authenticated;
grant select on public.public_categories to anon, authenticated;

-- ===========================================================================
-- GRANTS — authenticated (owners, staff, suppliers)
-- ===========================================================================
grant select on public.v_staff_products              to authenticated;
grant select on public.v_staff_suppliers             to authenticated;
grant select on public.v_staff_restocks              to authenticated;
grant select on public.v_staff_sales                 to authenticated;
grant select on public.v_staff_sale_items            to authenticated;
grant select on public.v_staff_stock_counts          to authenticated;
grant select on public.v_staff_stock_periods         to authenticated;
grant select on public.v_staff_commissions           to authenticated;
grant select on public.v_staff_commission_payments   to authenticated;
grant select on public.v_staff_customer_requests     to authenticated;

grant select on public.supplier_portal_orders     to authenticated;
grant select on public.supplier_portal_receipts   to authenticated;
grant select on public.supplier_portal_payments   to authenticated;
grant select on public.supplier_portal_statements to authenticated;
grant select on public.supplier_portal_profile    to authenticated;
grant select on public.supplier_portal_summary    to authenticated;

-- Owner financial views are deliberately NOT granted to any client role.
-- A definer view that calls fn_avg_unit_cost() would require that grant for
-- every `authenticated` caller, and one grant of a costing helper is all a
-- staff member needs to reconstruct purchase cost. The owner therefore reads
-- these figures through the SECURITY DEFINER report RPCs (rpc_report_inventory,
-- rpc_report_pnl, rpc_report_supplier_payable, …), which need no such grant.
-- The views remain in place as the single definition of each calculation, and
-- are used internally by those RPCs.

-- Base-table reads: RLS decides which rows each role actually sees.
grant select on public.app_users        to authenticated;
grant select on public.categories       to authenticated;   -- writes go through RPCs
grant select on public.products         to authenticated;
grant select on public.suppliers        to authenticated;
grant select on public.supplier_users   to authenticated;
grant select on public.stock_periods    to authenticated;
grant select on public.sales            to authenticated;
grant select on public.sale_items       to authenticated;
grant select on public.commissions      to authenticated;
grant select on public.commission_payments to authenticated;
grant select on public.expenses         to authenticated;
grant select on public.tithe_records    to authenticated;
grant select on public.period_closes    to authenticated;
grant select on public.audit_logs       to authenticated;
grant select on public.settings         to authenticated;
grant select on public.customer_requests to authenticated;
grant select on public.backup_runs      to authenticated;

-- NOTE: no grants at all for anon or authenticated on the following — they are
-- reachable only from inside SECURITY DEFINER functions:
--   purchase_batches, purchase_cost_history, restocks, stock_movements,
--   stock_counts, fifo_allocations, returns, return_items, supplier_payables,
--   supplier_payments, supplier_payment_allocations, supplier_statements,
--   supplier_internal_notes, number_sequences, request_rate_limit,
--   product_price_history
--
-- purchase_batches and restocks are in this list even though RLS would protect
-- them: every one of these tables carries cost data, and a missing grant is a
-- second, independent wall behind the row policy. The owner reads them through
-- rpc_list_batches() / rpc_list_restocks() instead.
grant select on public.product_price_history to authenticated;  -- owner-only via RLS below

-- ===========================================================================
-- POLICIES
-- ===========================================================================

-- --- app_users -------------------------------------------------------------
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (id = auth.uid() or public.fn_is_owner());

-- --- categories (internal read; writes via RPC) ----------------------------
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated using (public.fn_is_internal());

-- --- products --------------------------------------------------------------
-- Customers never touch this table (they read public_products).
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated using (public.fn_is_internal());

-- --- suppliers: identity for the owner, and for staff only via v_staff_suppliers
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated using (public.fn_is_owner());

-- --- supplier_users --------------------------------------------------------
drop policy if exists supplier_users_select on public.supplier_users;
create policy supplier_users_select on public.supplier_users
  for select to authenticated
  using (user_id = auth.uid() or public.fn_is_owner());

-- --- stock_periods: schedule is operational info, safe for staff -----------
drop policy if exists stock_periods_select on public.stock_periods;
create policy stock_periods_select on public.stock_periods
  for select to authenticated using (public.fn_is_internal());

-- --- sales / sale_items: OWNER ONLY at the table level ---------------------
-- Staff read their own sales through v_staff_sales / v_staff_sale_items, which
-- expose no cogs and no profit. At the table level they get nothing, so even a
-- raw REST call cannot reach cogs_amount or gross_profit.
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select to authenticated using (public.fn_is_owner());

drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items
  for select to authenticated using (public.fn_is_owner());

-- --- purchase_batches / restocks: cost lives here, so OWNER ONLY ----------
drop policy if exists purchase_batches_select on public.purchase_batches;
create policy purchase_batches_select on public.purchase_batches
  for select to authenticated using (public.fn_is_owner());

drop policy if exists restocks_select on public.restocks;
create policy restocks_select on public.restocks
  for select to authenticated using (public.fn_is_owner());

-- --- commissions: owner sees all; staff see their own ---------------------
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select to authenticated
  using (public.fn_is_owner() or staff_id = auth.uid());

drop policy if exists commission_payments_select on public.commission_payments;
create policy commission_payments_select on public.commission_payments
  for select to authenticated
  using (public.fn_is_owner() or staff_id = auth.uid());

-- --- owner-only reads ------------------------------------------------------
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated using (public.fn_is_owner());

drop policy if exists tithe_select on public.tithe_records;
create policy tithe_select on public.tithe_records
  for select to authenticated using (public.fn_is_owner());

drop policy if exists period_closes_select on public.period_closes;
create policy period_closes_select on public.period_closes
  for select to authenticated using (public.fn_is_owner());

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.fn_is_owner());

drop policy if exists backup_runs_select on public.backup_runs;
create policy backup_runs_select on public.backup_runs
  for select to authenticated using (public.fn_is_owner());

drop policy if exists price_history_select on public.product_price_history;
create policy price_history_select on public.product_price_history
  for select to authenticated using (public.fn_is_owner());

-- --- settings: public keys for everyone signed in (and for the catalog via
--     fn_public_settings); private keys for the owner only. Telegram bot
--     credentials are never in a public row, so they can never leak here.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (is_public or public.fn_is_owner());

-- --- customer_requests: internal only. The public may INSERT via RPC but can
--     never SELECT, because these rows hold customer phone numbers.
drop policy if exists customer_requests_select on public.customer_requests;
create policy customer_requests_select on public.customer_requests
  for select to authenticated using (public.fn_is_internal());

-- ===========================================================================
-- Deliberately NO insert/update/delete policies anywhere.
-- With RLS enabled and no permissive policy for those commands, the table is
-- read-only for every client role. All mutations happen in SECURITY DEFINER
-- RPCs that re-check the caller, so no client can ever write a financial row
-- directly, and audit_logs is immutable even for the Owner.
-- ===========================================================================

-- service_role (server-side jobs: seeding, backups, edge functions)
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
