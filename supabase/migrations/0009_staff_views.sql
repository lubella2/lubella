-- ============================================================================
-- LuBella  |  Migration 0009 — Staff-facing views
-- ============================================================================
-- Staff need the operational subset: what is on the shelf, who supplied it,
-- what came in, what they sold themselves, what they earned. They must never
-- reach cost, COGS, payable, margin or valuation. Rather than trusting React
-- to hide those fields, these views are the only staff-readable doorway and the
-- fields simply are not present in them.
-- ============================================================================

-- Supplier picker for the restock form: identity only, no financial columns.
create or replace view public.v_staff_suppliers
with (security_invoker = false) as
select s.id, s.supplier_code, s.name, s.active
from public.suppliers s
where s.active
  and public.fn_is_internal();

-- Receiving history. unit_cost and previous_unit_cost are intentionally absent;
-- cost_flagged only signals "the owner needs to review the price".
create or replace view public.v_staff_restocks
with (security_invoker = false) as
select
  r.id, r.restock_number, r.product_id, p.name as product_name, p.product_code,
  r.supplier_id, s.name as supplier_name,
  r.quantity, r.received_date, r.expiry_date, r.supplier_invoice,
  r.notes, r.cost_pending, r.cost_flagged, r.status,
  r.received_by, u.full_name as received_by_name,
  r.created_at
from public.restocks r
join public.products p on p.id = r.product_id
join public.suppliers s on s.id = r.supplier_id
left join public.app_users u on u.id = r.received_by
where public.fn_is_internal();

-- Own sales. No cogs_amount, no gross_profit, no other staff members' rows.
create or replace view public.v_staff_sales
with (security_invoker = false) as
select
  sa.id, sa.sale_number, sa.sale_date, sa.created_at,
  sa.subtotal, sa.discount_amount, sa.discount_percent, sa.total_amount,
  sa.returned_amount, sa.payment_method, sa.status, sa.staff_id
from public.sales sa
where sa.staff_id = auth.uid()
  and public.fn_is_internal();

-- Own sale lines. unit_price is the selling price (allowed); unit_cogs is not.
create or replace view public.v_staff_sale_items
with (security_invoker = false) as
select
  si.id, si.sale_id, si.product_id, p.name as product_name, p.product_code,
  si.quantity, si.unit_price, si.line_subtotal, si.line_discount, si.line_total,
  si.returned_qty
from public.sale_items si
join public.sales sa on sa.id = si.sale_id
join public.products p on p.id = si.product_id
where sa.staff_id = auth.uid()
  and public.fn_is_internal();

-- Physical count sheet entries: quantities and variance, no valuation columns.
create or replace view public.v_staff_stock_counts
with (security_invoker = false) as
select
  sc.id, sc.stock_period_id, sp.label as period_label,
  sc.product_id, p.name as product_name, p.product_code,
  sc.expected_quantity, sc.counted_quantity, sc.variance,
  sc.status, sc.notes, sc.created_at, sc.confirmed_at
from public.stock_counts sc
join public.stock_periods sp on sp.id = sc.stock_period_id
join public.products p on p.id = sc.product_id
where public.fn_is_internal();

-- Own commission ledger. Other staff members' rows are excluded.
create or replace view public.v_staff_commissions
with (security_invoker = false) as
select
  c.id, c.staff_id, c.sale_id, c.return_id, c.amount, c.rate, c.type,
  c.sale_date, c.note, c.created_at,
  sa.sale_number
from public.commissions c
left join public.sales sa on sa.id = c.sale_id
where c.staff_id = auth.uid()
  and public.fn_is_internal();

create or replace view public.v_staff_commission_payments
with (security_invoker = false) as
select cp.id, cp.payment_number, cp.staff_id, cp.period_start, cp.period_end,
       cp.amount, cp.payment_method, cp.payment_date, cp.reference, cp.notes, cp.created_at
from public.commission_payments cp
where cp.staff_id = auth.uid()
  and public.fn_is_internal();

-- Customer requests are operational for staff too (§4): they may process them,
-- but they see no financial columns (there are none on the table anyway).
create or replace view public.v_staff_customer_requests
with (security_invoker = false) as
select
  cr.id, cr.request_number, cr.customer_name, cr.customer_phone,
  cr.product_id, p.name as product_name, cr.requested_product_name,
  cr.quantity, cr.message, cr.photo_url, cr.source, cr.status,
  cr.was_unavailable, cr.created_at, cr.updated_at
from public.customer_requests cr
left join public.products p on p.id = cr.product_id
where public.fn_is_internal();
