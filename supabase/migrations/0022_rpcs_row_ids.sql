-- ============================================================================
-- LuBella  |  Migration 0022 — Row identities for owner actions
-- ============================================================================
-- Two read RPCs were returning everything the owner needs to *see* but not the
-- primary key they need to *act*. Without the id the UI would have to look the
-- row up again from a second source, which is exactly the kind of drift the
-- derived-data rule is meant to prevent, so the ids are returned instead.
--
--   rpc_report_expenses  → adds e.id            (void an expense)
--   rpc_report_inventory → adds p.id            (adjust stock from the report)
--
-- Numbered below 9999 so the API-surface grants still run last.
-- ============================================================================

create or replace function public.rpc_report_expenses(
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
  v_by_category jsonb;
  v_total numeric;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.expense_date desc), '[]'::jsonb) into v_items from (
    select e.id, e.expense_number, e.expense_date, e.category, e.amount, e.payment_method,
           e.description, e.receipt_url, u.full_name as created_by_name
    from public.expenses e left join public.app_users u on u.id = e.created_by
    where e.expense_date between p_from and p_to
    order by e.expense_date desc) t;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.total desc), '[]'::jsonb) into v_by_category from (
    select category, public.fn_money(sum(amount)) as total, count(*) as entries
    from public.expenses where expense_date between p_from and p_to
    group by category) c;

  select public.fn_money(coalesce(sum(amount), 0)) into v_total
  from public.expenses where expense_date between p_from and p_to;

  return jsonb_build_object('from', p_from, 'to', p_to, 'items', v_items,
                            'by_category', v_by_category, 'total', v_total);
end $$;

create or replace function public.rpc_report_inventory(
  p_category_id uuid default null, p_only_attention boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_totals record;
begin
  perform public.fn_require_owner();

  -- Identical to the original except for v.product_id, which the owner needs in
  -- order to adjust stock straight from this report.
  select coalesce(jsonb_agg(to_jsonb(t) order by t.stock_value desc, t.name), '[]'::jsonb) into v_items
  from (
    select v.product_id, v.product_code, v.name, v.category_name, v.supplier_name, v.quantity_on_hand,
           v.avg_unit_cost, v.stock_value, v.selling_price, v.unit_margin, v.availability,
           v.expiry_status, v.expiry_date, v.minimum_stock
    from public.v_owner_inventory v
    where (p_category_id is null or v.category_name = (select name from public.categories where id = p_category_id))
      and (not p_only_attention or v.availability <> 'AVAILABLE' or v.expiry_status in ('EXPIRED','EXPIRING_SOON'))
  ) t;

  select public.fn_money(sum(stock_value)) as total_value,
         sum(quantity_on_hand) as total_units,
         count(*) as sku_count,
         public.fn_money(sum(quantity_on_hand * selling_price)) as retail_value
    into v_totals from public.v_owner_inventory;

  return jsonb_build_object('items', v_items, 'totals', to_jsonb(v_totals));
end $$;
