-- ============================================================================
-- LuBella  |  Migration 0020 — Remaining read RPCs
-- ============================================================================
-- Supplier payment history and the staff-performance report. Kept in their own
-- migration (appended, never folded into an applied one) and numbered below
-- 9999 so the API-surface grants still run last.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Supplier payments (owner). NOT an expense — this is a balance-sheet
-- settlement, so it has its own report and never appears in the P&L (§24).
-- ---------------------------------------------------------------------------
create or replace function public.rpc_report_supplier_payments(
  p_supplier_id uuid default null,
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_total numeric;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.payment_date desc), '[]'::jsonb) into v_items
  from (
    select sp.id, sp.payment_number, sp.supplier_id, s.name as supplier_name,
           sp.amount, sp.payment_method, sp.payment_date, sp.reference, sp.notes,
           sp.created_at, sp.voided_at,
           (select count(*) from public.supplier_payment_allocations a where a.payment_id = sp.id) as lines_settled
    from public.supplier_payments sp
    join public.suppliers s on s.id = sp.supplier_id
    where (p_supplier_id is null or sp.supplier_id = p_supplier_id)
      and (p_from is null or sp.payment_date >= p_from)
      and (p_to   is null or sp.payment_date <= p_to)
    order by sp.payment_date desc, sp.created_at desc) t;

  select public.fn_money(coalesce(sum(amount), 0)) into v_total
  from public.supplier_payments
  where voided_at is null
    and (p_supplier_id is null or supplier_id = p_supplier_id)
    and (p_from is null or payment_date >= p_from)
    and (p_to   is null or payment_date <= p_to);

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'note', 'Supplier payments settle stock already recognised in COGS at the time of sale. They are not operating expenses and are excluded from net profit.'
  );
end $$;

-- ---------------------------------------------------------------------------
-- Staff performance (owner, §55): sales, discounts and commission per person,
-- paired with what they were paid. Deliberately excludes cost and profit — the
-- owner sees those in the P&L, not attributed per staff member here.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_report_staff_performance(
  p_from date default date_trunc('month', current_date)::date,
  p_to   date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.net_sales desc), '[]'::jsonb) into v_items
  from (
    select u.id as staff_id, u.full_name, u.role, u.commission_rate, u.active,
           count(sa.id) as sale_count,
           public.fn_money(coalesce(sum(sa.subtotal), 0)) as gross_sales,
           public.fn_money(coalesce(sum(sa.discount_amount), 0)) as discounts_given,
           public.fn_money(coalesce(sum(sa.returned_amount), 0)) as returns,
           public.fn_money(coalesce(sum(sa.total_amount - sa.returned_amount), 0)) as net_sales,
           public.fn_money(coalesce(sum(sa.total_amount - sa.returned_amount)
                                    / nullif(count(sa.id), 0), 0)) as average_sale,
           public.fn_money(coalesce((select sum(c.amount) from public.commissions c
              where c.staff_id = u.id and c.sale_date between p_from and p_to), 0)) as commission
    from public.app_users u
    left join public.sales sa
      on sa.staff_id = u.id and sa.sale_date between p_from and p_to and sa.status <> 'VOIDED'
    where u.role in ('STAFF','OWNER')
    group by u.id, u.full_name, u.role, u.commission_rate, u.active) t;

  return jsonb_build_object('from', p_from, 'to', p_to, 'staff', v_items);
end $$;

-- ---------------------------------------------------------------------------
-- Daily sales series. Used by the owner dashboard and the Reports page so the
-- chart and the table read the same aggregation.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_report_daily_sales(
  p_from date default (current_date - 29),
  p_to   date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.sale_date), '[]'::jsonb) into v_items
  from (
    select d::date as sale_date,
           count(sa.id) as sale_count,
           public.fn_money(coalesce(sum(sa.total_amount - sa.returned_amount), 0)) as net_sales,
           public.fn_money(coalesce(sum(sa.discount_amount), 0)) as discounts,
           public.fn_money(coalesce(sum(sa.cogs_amount), 0)) as cogs,
           public.fn_money(coalesce(sum(sa.total_amount - sa.returned_amount - sa.cogs_amount), 0)) as gross_profit
    from generate_series(p_from, p_to, interval '1 day') d
    left join public.sales sa on sa.sale_date = d::date and sa.status <> 'VOIDED'
    group by d) t;

  return jsonb_build_object('from', p_from, 'to', p_to, 'items', v_items);
end $$;
