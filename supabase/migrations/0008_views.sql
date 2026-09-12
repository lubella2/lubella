-- ============================================================================
-- LuBella  |  Migration 0008 — Curated views
-- ============================================================================
-- Two kinds of view, deliberately different:
--
--  1. COLUMN-CURATED views (security_invoker = false, i.e. definer).
--     Owned by the database owner, granted to a specific audience, and written
--     so that restricted columns simply DO NOT EXIST in the view. This is how
--     staff get real stock numbers without ever being able to reach cost, and
--     how a supplier gets their ledger without ever reaching LuBella's margin.
--
--  2. GUARDED views for owner-only financial reports.
--     These are also definer views, but every one of them carries an explicit
--     `where public.fn_is_owner()` predicate, so a staff or supplier token gets
--     zero rows even though the view name is guessable. Two independent layers
--     (grant + guard) plus the owner-only RLS on the base tables.
--
--     They are deliberately NOT security_invoker: an invoker view would force
--     us to grant staff EXECUTE on cost helpers such as fn_avg_unit_cost(),
--     and that grant would itself be the leak we are closing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Availability is a first-class business rule, so it lives in one function.
--   out  : nothing sellable
--   low  : at or below the product's configured minimum
--   available
-- ---------------------------------------------------------------------------
create or replace function public.fn_availability(p_on_hand int, p_minimum int)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_on_hand, 0) <= 0 then 'OUT'
    when coalesce(p_on_hand, 0) <= greatest(coalesce(p_minimum, 0), 0) then 'LOW'
    else 'AVAILABLE'
  end;
$$;

create or replace function public.fn_expiry_status(p_expiry date, p_warn_days int)
returns text
language sql
immutable
as $$
  select case
    when p_expiry is null then 'NONE'
    when p_expiry < current_date then 'EXPIRED'
    when p_expiry <= current_date + make_interval(days => greatest(p_warn_days, 0)) then 'EXPIRING_SOON'
    else 'OK'
  end;
$$;

-- ---------------------------------------------------------------------------
-- IMPORTANT PostgreSQL behaviour this file depends on:
--   Inside a definer view (security_invoker = false), privileges on the
--   underlying TABLES are checked against the view owner, but EXECUTE on any
--   FUNCTION in the view is checked against the CALLER. A view that calls
--   fn_on_hand() therefore forces us to grant fn_on_hand to whoever may read
--   the view — which for the public catalog would leak exact stock quantities.
--
--   So every function used by a view is an audience-guarded wrapper that
--   returns only what that audience is entitled to. The dangerous primitives
--   (fn_on_hand, fn_avg_unit_cost, fn_setting) stay ungranted, and are reachable
--   only from inside SECURITY DEFINER code, where the current user IS the owner.
-- ---------------------------------------------------------------------------

-- Public: the availability BAND only. Never a quantity. (§7)
create or replace function public.fn_public_availability(p_product_id uuid, p_minimum int)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- plpgsql, not SQL: a LANGUAGE sql SECURITY DEFINER body can be inlined by the
  -- planner, and an inlined body is privilege-checked as the caller — which
  -- would make this wrapper demand EXECUTE on fn_on_hand from the public.
  return public.fn_availability(public.fn_on_hand(p_product_id), p_minimum);
end $$;

-- Staff: real quantities are needed at the till (§4), so this one returns the
-- number — but refuses anyone who is not an active owner/staff member. A
-- supplier or customer calling it is rejected, and because the staff views also
-- filter on fn_is_internal(), a supplier gets an empty result rather than an
-- error (the guarded function is never invoked for zero rows).
create or replace function public.fn_staff_on_hand(p_product_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.fn_is_internal() then
    raise exception 'INTERNAL_ONLY: stock quantities are LuBella operational data' using errcode = '42501';
  end if;
  return public.fn_on_hand(p_product_id);
end $$;

-- ===========================================================================
-- 1. PUBLIC CUSTOMER CATALOG
-- ===========================================================================
-- Exposes: image, name, category, brand, selling price, description,
--          availability band, featured / new flags.
-- Does NOT expose: cost, supplier, supplier identity, margin, stock value,
--          exact quantities, internal ids of suppliers, owner notes.
create or replace view public.public_products
with (security_invoker = false) as
select
  p.id,
  p.product_code,
  p.name,
  p.brand,
  p.description,
  p.keywords,
  p.image_url,
  p.selling_price,
  p.featured,
  p.category_id,
  c.name  as category_name,
  c.slug  as category_slug,
  p.created_at,
  (p.created_at >= now() - interval '30 days') as is_new,
  public.fn_public_availability(p.id, p.minimum_stock) as availability,
  case public.fn_public_availability(p.id, p.minimum_stock)
    when 'OUT' then '🔴 Out of Stock'
    when 'LOW' then '🟡 Low Stock'
    else '🟢 Available'
  end as availability_label
from public.products p
left join public.categories c on c.id = p.category_id
where p.active
  and p.is_public
  and not (p.expiry_date is not null and p.expiry_date < current_date);

create or replace view public.public_categories
with (security_invoker = false) as
select
  c.id, c.name, c.slug, c.description, c.image_url, c.sort_order,
  count(p.id) filter (where p.active and p.is_public) as product_count
from public.categories c
left join public.products p on p.category_id = c.id
where c.active
group by c.id;

-- ===========================================================================
-- 2. STAFF VIEW — real stock numbers, zero cost information
-- ===========================================================================
-- Quantity on hand is operationally necessary at the till. Cost is not, so
-- unit_cost / COGS / payables are simply absent from this view.
create or replace view public.v_staff_products
with (security_invoker = false) as
select
  p.id,
  p.product_code,
  p.name,
  p.category_id,
  c.name as category_name,
  p.brand,
  p.supplier_id,
  s.name as supplier_name,          -- staff may pick a supplier on restock (§27)
  p.image_url,
  p.selling_price,                  -- selling price is explicitly allowed (§4)
  p.minimum_stock,
  p.expiry_date,
  public.fn_expiry_status(p.expiry_date,
    coalesce((public.fn_public_setting('expiry_warning_days', '30'::jsonb))::text::int, 30)) as expiry_status,
  p.description,
  p.active,
  public.fn_staff_on_hand(p.id) as quantity_on_hand,
  public.fn_availability(public.fn_staff_on_hand(p.id), p.minimum_stock) as availability,
  case when public.fn_staff_on_hand(p.id) <= 0 then true else false end as is_out_of_stock,
  case when public.fn_staff_on_hand(p.id) > 0
         and public.fn_staff_on_hand(p.id) <= p.minimum_stock then true else false end as is_low_stock,
  p.created_at,
  p.updated_at
from public.products p
left join public.categories c on c.id = p.category_id
left join public.suppliers s on s.id = p.supplier_id
where public.fn_is_internal();

-- Stock periods are operational schedule information, safe for staff.
create or replace view public.v_staff_stock_periods
with (security_invoker = false) as
select id, label, period_start, period_end, status, closed_at, closed_by, created_at
from public.stock_periods;

-- ===========================================================================
-- 3. SUPPLIER PORTAL VIEWS — hard-filtered to the calling supplier
-- ===========================================================================
-- Every one of these is filtered by fn_current_supplier_id(), which returns
-- NULL for anyone who is not an active supplier user, so an owner, a staff
-- member, or a different supplier sees an empty set. Selling price, LuBella
-- margin, owner notes and other suppliers' rows are absent by construction.
create or replace view public.supplier_portal_orders
with (security_invoker = false) as
select
  sp.id,
  sp.entry_date,
  sp.quantity_sold,
  sp.purchase_cost            as unit_cost,
  sp.payable_amount,
  sp.amount_paid,
  sp.outstanding,
  sp.status,
  sp.is_reversal,
  p.name                      as product_name,
  p.product_code,
  b.batch_number,
  b.received_date
from public.supplier_payables sp
join public.products p on p.id = sp.product_id
join public.purchase_batches b on b.id = sp.purchase_batch_id
where sp.supplier_id = public.fn_current_supplier_id();

create or replace view public.supplier_portal_receipts
with (security_invoker = false) as
select
  b.id,
  b.batch_number,
  b.received_date,
  b.quantity_received,
  b.quantity_sold,
  b.quantity_remaining,
  b.unit_cost,
  b.expiry_date,
  b.cost_status,
  p.name        as product_name,
  p.product_code
from public.purchase_batches b
join public.products p on p.id = b.product_id
where b.supplier_id = public.fn_current_supplier_id();

create or replace view public.supplier_portal_payments
with (security_invoker = false) as
select
  sp.id,
  sp.payment_number,
  sp.amount,
  sp.payment_method,
  sp.payment_date,
  sp.reference,
  sp.notes,
  sp.created_at
from public.supplier_payments sp
where sp.supplier_id = public.fn_current_supplier_id()
  and sp.voided_at is null;

create or replace view public.supplier_portal_statements
with (security_invoker = false) as
select
  st.id, st.statement_number, st.period_month,
  st.opening_outstanding, st.units_sold, st.total_payable, st.total_paid,
  st.outstanding, st.generated_at,
  s.name as supplier_name, s.contact_name, s.phone, s.email, s.address
from public.supplier_statements st
join public.suppliers s on s.id = st.supplier_id
where st.supplier_id = public.fn_current_supplier_id();

create or replace view public.supplier_portal_profile
with (security_invoker = false) as
select
  s.id, s.supplier_code, s.name, s.contact_name, s.phone, s.email, s.address,
  s.tin_number, s.payment_terms, s.active
from public.suppliers s
where s.id = public.fn_current_supplier_id();

-- Supplier dashboard totals, computed from transactions (never typed in).
create or replace view public.supplier_portal_summary
with (security_invoker = false) as
with sid as (select public.fn_current_supplier_id() as supplier_id)
select
  sid.supplier_id,
  (select count(distinct product_id) from public.purchase_batches b
    where b.supplier_id = sid.supplier_id)::int                       as products_supplied,
  (select coalesce(sum(quantity_received), 0) from public.purchase_batches b
    where b.supplier_id = sid.supplier_id)::int                       as units_supplied,
  (select coalesce(sum(quantity_sold), 0) from public.purchase_batches b
    where b.supplier_id = sid.supplier_id)::int                       as units_sold,
  (select coalesce(sum(payable_amount), 0) from public.supplier_payables sp
    where sp.supplier_id = sid.supplier_id)                           as total_payable,
  (select coalesce(sum(amount), 0) from public.supplier_payments pm
    where pm.supplier_id = sid.supplier_id and pm.voided_at is null)  as total_paid,
  (select coalesce(sum(outstanding), 0) from public.supplier_payables sp
    where sp.supplier_id = sid.supplier_id)                           as outstanding,
  (select coalesce(sum(quantity_remaining), 0) from public.purchase_batches b
    where b.supplier_id = sid.supplier_id)::int                       as units_in_stock
from sid;

-- ===========================================================================
-- 4. OWNER FINANCIAL VIEWS (invoker semantics — underlying RLS is owner-only)
-- ===========================================================================

-- Inventory valuation at cost (owner-only information).
create or replace view public.v_owner_inventory
with (security_invoker = false) as
select
  p.id as product_id,
  p.product_code,
  p.name,
  c.name as category_name,
  s.name as supplier_name,
  public.fn_on_hand(p.id) as quantity_on_hand,
  public.fn_avg_unit_cost(p.id) as avg_unit_cost,
  public.fn_money(public.fn_on_hand(p.id) * public.fn_avg_unit_cost(p.id)) as stock_value,
  p.selling_price,
  case when public.fn_avg_unit_cost(p.id) > 0
       then public.fn_money(p.selling_price - public.fn_avg_unit_cost(p.id)) end as unit_margin,
  p.minimum_stock,
  public.fn_availability(public.fn_on_hand(p.id), p.minimum_stock) as availability,
  p.expiry_date,
  public.fn_expiry_status(p.expiry_date,
    coalesce((public.fn_setting('expiry_warning_days', '30'::jsonb))::text::int, 30)) as expiry_status
from public.products p
left join public.categories c on c.id = p.category_id
left join public.suppliers s on s.id = p.supplier_id
where public.fn_is_owner();

-- Monthly P&L. Sales − discounts − returns = net sales; net sales − COGS =
-- gross profit; − operating expenses − staff commission = net profit.
create or replace view public.v_pnl_monthly
with (security_invoker = false) as
with months as (
  select date_trunc('month', sale_date)::date as period_month from public.sales
  union
  select date_trunc('month', expense_date)::date from public.expenses
  union
  select date_trunc('month', sale_date)::date from public.commissions
),
s as (
  select date_trunc('month', sale_date)::date as period_month,
         sum(subtotal)        as gross_sales,
         sum(discount_amount) as discounts,
         sum(returned_amount) as returns,
         sum(total_amount - returned_amount) as net_sales,
         sum(cogs_amount)     as cogs
  from public.sales
  where status <> 'VOIDED'
  group by 1
),
e as (
  select date_trunc('month', expense_date)::date as period_month, sum(amount) as expenses
  from public.expenses group by 1
),
cm as (
  select date_trunc('month', sale_date)::date as period_month, sum(amount) as commission
  from public.commissions group by 1
)
select
  m.period_month,
  public.fn_money(coalesce(s.gross_sales, 0))  as gross_sales,
  public.fn_money(coalesce(s.discounts, 0))    as discounts,
  public.fn_money(coalesce(s.returns, 0))      as returns,
  public.fn_money(coalesce(s.net_sales, 0))    as net_sales,
  public.fn_money(coalesce(s.cogs, 0))         as cogs,
  public.fn_money(coalesce(s.net_sales, 0) - coalesce(s.cogs, 0)) as gross_profit,
  public.fn_money(coalesce(e.expenses, 0))     as operating_expenses,
  public.fn_money(coalesce(cm.commission, 0))  as staff_commission,
  public.fn_money(coalesce(s.net_sales, 0) - coalesce(s.cogs, 0)
                  - coalesce(e.expenses, 0) - coalesce(cm.commission, 0)) as net_profit,
  public.fn_money(greatest(coalesce(s.net_sales, 0) - coalesce(s.cogs, 0)
                  - coalesce(e.expenses, 0) - coalesce(cm.commission, 0), 0) * 0.10) as tithe_due_10pct
from months m
left join s  on s.period_month = m.period_month
left join e  on e.period_month = m.period_month
left join cm on cm.period_month = m.period_month
where public.fn_is_owner()
order by m.period_month desc;

-- Supplier credit book: outstanding per supplier, in transaction terms.
create or replace view public.v_owner_supplier_balance
with (security_invoker = false) as
select
  s.id as supplier_id,
  s.supplier_code,
  s.name,
  coalesce(sum(sp.payable_amount), 0) as total_payable,
  coalesce(sum(sp.amount_paid), 0)    as total_paid,
  coalesce(sum(sp.outstanding), 0)    as outstanding,
  count(sp.id) filter (where sp.status <> 'PAID') as open_lines,
  max(sp.entry_date) as last_activity
from public.suppliers s
left join public.supplier_payables sp on sp.supplier_id = s.id
where public.fn_is_owner()
group by s.id;

-- Supplier payment history (NOT an expense — kept out of the P&L by design).
create or replace view public.v_owner_supplier_payments
with (security_invoker = false) as
select sp.id, sp.payment_number, sp.supplier_id, s.name as supplier_name,
       sp.amount, sp.payment_method, sp.payment_date, sp.reference, sp.notes,
       sp.created_at, sp.voided_at
from public.supplier_payments sp
join public.suppliers s on s.id = sp.supplier_id
where public.fn_is_owner();
