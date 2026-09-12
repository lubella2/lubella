-- ============================================================================
-- LuBella  |  Migration 0016 — Dashboards & reports
-- ============================================================================
-- Every figure here is aggregate-only, so the JSON that reaches a browser
-- contains summaries rather than the underlying cost records. Role separation
-- is enforced twice: the function refuses the wrong caller, and the tables it
-- reads are themselves owner-only under RLS.
-- ============================================================================

-- ===========================================================================
-- Owner dashboard (spec §43)
-- ===========================================================================
create or replace function public.rpc_owner_dashboard(
  p_date date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_week_start date := date_trunc('week', p_date)::date;
  v_month_start date := date_trunc('month', p_date)::date;
  r jsonb;
  v_day   record; v_week record; v_month record;
  v_stock record;
  v_alerts jsonb := '[]'::jsonb;
  v_top jsonb;
  v_trend jsonb;
  v_staff jsonb;
  v_requests jsonb;
  v_demand jsonb;
  v_supplier_outstanding numeric;
  v_pnl record;
  v_warn_days int := coalesce((public.fn_setting('expiry_warning_days', '30'::jsonb))::text::int, 30);
begin
  perform public.fn_require_owner();

  select * into v_pnl from public.v_pnl_monthly where period_month = v_month_start;

  select public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) as net,
         count(*) as sales_count,
         public.fn_money(coalesce(sum(total_amount - returned_amount - cogs_amount), 0)) as gross,
         public.fn_money(coalesce(sum(total_amount - returned_amount) * 0.03, 0)) as commission_estimate
    into v_day from public.sales
   where sale_date = p_date and status <> 'VOIDED';

  select public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) as net, count(*) as sales_count
    into v_week from public.sales
   where sale_date between v_week_start and p_date and status <> 'VOIDED';

  select public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) as net, count(*) as sales_count
    into v_month from public.sales
   where sale_date between v_month_start and p_date and status <> 'VOIDED';

  select
    coalesce(sum(public.fn_on_hand(p.id)), 0) as stock_units,
    public.fn_money(coalesce(sum(public.fn_on_hand(p.id) * public.fn_avg_unit_cost(p.id)), 0)) as stock_value,
    count(*) filter (where public.fn_on_hand(p.id) > 0 and public.fn_on_hand(p.id) <= p.minimum_stock) as low_stock,
    count(*) filter (where public.fn_on_hand(p.id) <= 0) as out_of_stock,
    count(*) filter (where p.expiry_date is not null and p.expiry_date < p_date) as expired,
    count(*) filter (where p.expiry_date is not null and p.expiry_date >= p_date
                       and p.expiry_date <= p_date + v_warn_days) as expiring_soon
    into v_stock from public.products p where p.active;

  select coalesce(sum(outstanding), 0) into v_supplier_outstanding from public.supplier_payables;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.revenue desc), '[]'::jsonb) into v_top from (
    select p.name, p.product_code, sum(si.quantity) as units,
           public.fn_money(sum(si.line_total)) as revenue,
           public.fn_money(sum(si.line_cogs)) as cogs
    from public.sale_items si
    join public.sales sa on sa.id = si.sale_id
    join public.products p on p.id = si.product_id
    where sa.status <> 'VOIDED' and sa.sale_date >= v_month_start
    group by p.id, p.name, p.product_code
    order by sum(si.line_total) desc limit 5) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.d), '[]'::jsonb) into v_trend from (
    select d::date as d,
           public.fn_money(coalesce((select sum(total_amount - returned_amount) from public.sales s
              where s.sale_date = d::date and s.status <> 'VOIDED'), 0)) as revenue
    from generate_series(p_date - 13, p_date, interval '1 day') d) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.revenue desc), '[]'::jsonb) into v_staff from (
    select u.full_name, u.id as staff_id,
           count(sa.id) as sales_count,
           public.fn_money(coalesce(sum(sa.total_amount - sa.returned_amount), 0)) as revenue,
           public.fn_money(coalesce((select sum(c.amount) from public.commissions c
              where c.staff_id = u.id and c.sale_date between v_month_start and p_date), 0)) as commission
    from public.app_users u
    left join public.sales sa on sa.staff_id = u.id and sa.sale_date between v_month_start and p_date
                              and sa.status <> 'VOIDED'
    where u.role = 'STAFF' and u.active
    group by u.id, u.full_name) t;

  select jsonb_build_object(
      'new', count(*) filter (where status = 'NEW'),
      'open', count(*) filter (where status not in ('FULFILLED','CANCELLED')),
      'total', count(*),
      'recent', coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc) filter (where t.rn <= 5), '[]'::jsonb))
    into v_requests from (
      select cr.id, cr.request_number, cr.customer_name, cr.customer_phone,
             cr.requested_product_name, cr.quantity, cr.status, cr.source,
             cr.was_unavailable, cr.created_at,
             row_number() over (order by cr.created_at desc) rn
      from public.customer_requests cr) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.request_count desc), '[]'::jsonb) into v_demand from (
    select coalesce(p.name, cr.requested_product_name) as product_name,
           cr.product_id,
           count(*) as request_count,
           count(distinct cr.customer_phone) as unique_customers,
           max(cr.created_at) as last_requested,
           public.fn_on_hand(cr.product_id) as quantity_on_hand,
           coalesce(public.fn_availability(public.fn_on_hand(cr.product_id),
                    (select minimum_stock from public.products where id = cr.product_id)), 'OUT') as availability,
           bool_or(cr.was_unavailable) as unavailable_request
    from public.customer_requests cr
    left join public.products p on p.id = cr.product_id
    where cr.status <> 'CANCELLED' and cr.created_at >= v_month_start - interval '90 days'
    group by cr.product_id, coalesce(p.name, cr.requested_product_name)
    limit 8) t;

  -- Alerts (spec §43)
  select coalesce(jsonb_agg(a order by a ->> 'severity', a ->> 'title'), '[]'::jsonb) into v_alerts from (
    select jsonb_build_object('severity','warning','type','LOW_STOCK','title', p.name,
             'detail', format('%s left — at or below the minimum of %s', public.fn_on_hand(p.id), p.minimum_stock),
             'product_id', p.id) a
    from public.products p
    where p.active and public.fn_on_hand(p.id) > 0 and public.fn_on_hand(p.id) <= p.minimum_stock
    union all
    select jsonb_build_object('severity','danger','type','OUT_OF_STOCK','title', p.name,
             'detail','Out of stock', 'product_id', p.id)
    from public.products p where p.active and public.fn_on_hand(p.id) <= 0
    union all
    select jsonb_build_object('severity','danger','type','EXPIRED','title', p.name,
             'detail', format('Expired on %s — cannot be sold', to_char(p.expiry_date,'DD Mon YYYY')),
             'product_id', p.id)
    from public.products p where p.active and p.expiry_date is not null and p.expiry_date < p_date
    union all
    select jsonb_build_object('severity','warning','type','EXPIRING','title', p.name,
             'detail', format('Expires %s', to_char(p.expiry_date,'DD Mon YYYY')), 'product_id', p.id)
    from public.products p
    where p.active and p.expiry_date is not null and p.expiry_date >= p_date
      and p.expiry_date <= p_date + v_warn_days
    union all
    select jsonb_build_object('severity','info','type','COST_PENDING','title', p.name,
             'detail', 'Received without a purchase cost — record it so payables are final',
             'product_id', p.id, 'batch_id', b.id)
    from public.purchase_batches b join public.products p on p.id = b.product_id
    where b.cost_status = 'PENDING'
    union all
    select jsonb_build_object('severity','info','type','DEMAND','title',
             coalesce(p.name, cr.requested_product_name),
             'detail', format('%s customer(s) requested this and it is unavailable',
                              count(distinct cr.customer_phone)),
             'product_id', cr.product_id)
    from public.customer_requests cr
    left join public.products p on p.id = cr.product_id
    where cr.was_unavailable and cr.status not in ('CANCELLED','FULFILLED')
    group by cr.product_id, coalesce(p.name, cr.requested_product_name)
  ) x;

  return jsonb_build_object(
    'today', jsonb_build_object('sales', v_day.net, 'transactions', v_day.sales_count,
                                'gross_profit', v_day.gross),
    'week', jsonb_build_object('sales', v_week.net, 'transactions', v_week.sales_count),
    'month', jsonb_build_object('sales', v_month.net, 'transactions', v_month.sales_count,
                                'net_sales', coalesce(v_pnl.net_sales, 0),
                                'cogs', coalesce(v_pnl.cogs, 0),
                                'gross_profit', coalesce(v_pnl.gross_profit, 0),
                                'expenses', coalesce(v_pnl.operating_expenses, 0),
                                'commission', coalesce(v_pnl.staff_commission, 0),
                                'net_profit', coalesce(v_pnl.net_profit, 0),
                                'tithe_due', coalesce(v_pnl.tithe_due_10pct, 0)),
    'supplier_payable', public.fn_money(coalesce(v_supplier_outstanding, 0)),
    'stock', jsonb_build_object('units', v_stock.stock_units, 'value', v_stock.stock_value,
                                'low_stock', v_stock.low_stock, 'out_of_stock', v_stock.out_of_stock,
                                'expired', v_stock.expired, 'expiring_soon', v_stock.expiring_soon),
    'top_products', coalesce(v_top, '[]'::jsonb),
    'sales_trend', coalesce(v_trend, '[]'::jsonb),
    'staff_performance', coalesce(v_staff, '[]'::jsonb),
    'customer_requests', coalesce(v_requests, '{}'::jsonb),
    'customer_demand', coalesce(v_demand, '[]'::jsonb),
    'alerts', coalesce(v_alerts, '[]'::jsonb)
  );
end $$;

-- ===========================================================================
-- Staff dashboard (spec §44) — operational only. No profit, COGS, payable,
-- purchase cost, stock value, expenses or other staff members' figures.
-- ===========================================================================
create or replace function public.rpc_staff_dashboard(p_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_date)::date;
  v_today record;
  v_mine record;
  v_stock record;
  v_pending int;
begin
  if not public.fn_is_internal() then
    raise exception 'INTERNAL_ONLY: this dashboard is for LuBella staff' using errcode = '42501';
  end if;

  select public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) as amount, count(*) as txns
    into v_today from public.sales
   where sale_date = p_date and status <> 'VOIDED';

  select public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) as amount, count(*) as txns
    into v_mine from public.sales
   where staff_id = v_uid and sale_date = p_date and status <> 'VOIDED';

  select
    count(*) filter (where public.fn_on_hand(p.id) > 0) as available,
    count(*) filter (where public.fn_on_hand(p.id) > 0 and public.fn_on_hand(p.id) <= p.minimum_stock) as low,
    count(*) filter (where public.fn_on_hand(p.id) <= 0) as out
    into v_stock from public.products p where p.active;

  select count(*) into v_pending from public.restocks where cost_pending;

  return jsonb_build_object(
    'today_sales', jsonb_build_object('amount', v_today.amount, 'transactions', v_today.txns),
    'my_sales_today', jsonb_build_object('amount', v_mine.amount, 'transactions', v_mine.txns),
    'my_sales_month', jsonb_build_object(
        'amount', (select public.fn_money(coalesce(sum(total_amount - returned_amount), 0))
                   from public.sales where staff_id = v_uid and sale_date >= v_month_start and status <> 'VOIDED'),
        'transactions', (select count(*) from public.sales
                   where staff_id = v_uid and sale_date >= v_month_start and status <> 'VOIDED')),
    'my_commission_month', (select public.fn_money(coalesce(sum(amount), 0)) from public.commissions
                            where staff_id = v_uid and sale_date >= v_month_start),
    'products', jsonb_build_object('available', v_stock.available, 'low_stock', v_stock.low,
                                   'out_of_stock', v_stock.out),
    'pending_restocks', coalesce(v_pending, 0),
    'recent_sales', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select sale_number, sale_date, total_amount, discount_amount, payment_method, status
        from public.sales where staff_id = v_uid and status <> 'VOIDED'
        order by created_at desc limit 8) t), '[]'::jsonb)
  );
end $$;

-- ===========================================================================
-- Reports (spec §55)
-- ===========================================================================
create or replace function public.rpc_report_sales(
  p_from date default current_date, p_to date default current_date,
  p_staff_id uuid default null, p_payment_method public.payment_method default null
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select sa.id, sa.sale_number, sa.sale_date, sa.created_at, u.full_name as staff_name,
           sa.subtotal, sa.discount_amount, sa.total_amount, sa.returned_amount,
           public.fn_money(sa.total_amount - sa.returned_amount) as net_amount,
           sa.cogs_amount, sa.gross_profit, sa.payment_method, sa.status,
           (select count(*) from public.sale_items si where si.sale_id = sa.id) as line_count
    from public.sales sa
    join public.app_users u on u.id = sa.staff_id
    where sa.sale_date between p_from and p_to
      and (p_staff_id is null or sa.staff_id = p_staff_id)
      and (p_payment_method is null or sa.payment_method = p_payment_method)
    order by sa.created_at desc) t;

  select public.fn_money(coalesce(sum(subtotal), 0)) as gross_sales,
         public.fn_money(coalesce(sum(discount_amount), 0)) as discounts,
         public.fn_money(coalesce(sum(returned_amount), 0)) as returns,
         public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) as net_sales,
         public.fn_money(coalesce(sum(cogs_amount), 0)) as cogs,
         public.fn_money(coalesce(sum(total_amount - returned_amount - cogs_amount), 0)) as gross_profit,
         count(*) as sale_count
    into v_totals from public.sales
   where sale_date between p_from and p_to and status <> 'VOIDED'
     and (p_staff_id is null or staff_id = p_staff_id)
     and (p_payment_method is null or payment_method = p_payment_method);

  return jsonb_build_object('from', p_from, 'to', p_to, 'totals', to_jsonb(v_totals), 'items', v_items);
end $$;

create or replace function public.rpc_report_product_sales(
  p_from date default current_date, p_to date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_costed jsonb;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.revenue desc), '[]'::jsonb) into v_items from (
    select p.name, p.product_code, c.name as category,
           sum(si.quantity) as units_sold,
           public.fn_money(sum(si.line_subtotal)) as gross_revenue,
           public.fn_money(sum(si.line_discount)) as discounts,
           public.fn_money(sum(si.line_total)) as net_revenue,
           public.fn_money(sum(si.line_cogs)) as cogs,
           public.fn_money(sum(si.line_total - si.line_cogs)) as gross_profit,
           sum(si.returned_qty) as units_returned
    from public.sale_items si
    join public.sales sa on sa.id = si.sale_id
    join public.products p on p.id = si.product_id
    left join public.categories c on c.id = p.category_id
    where sa.sale_date between p_from and p_to and sa.status <> 'VOIDED'
    group by p.id, p.name, p.product_code, c.name) t;

  -- Product performance against what customers asked for — the buying insight.
  select coalesce(jsonb_agg(to_jsonb(t) order by t.requests desc), '[]'::jsonb) into v_costed from (
    select coalesce(p.name, cr.requested_product_name) as product_name,
           count(*) as requests, count(distinct cr.customer_phone) as customers,
           max(cr.created_at) as last_requested
    from public.customer_requests cr left join public.products p on p.id = cr.product_id
    where cr.created_at::date between p_from and p_to
    group by cr.product_id, coalesce(p.name, cr.requested_product_name)) t;

  return jsonb_build_object('from', p_from, 'to', p_to, 'products', v_items, 'demand', v_costed);
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.stock_value desc, t.name), '[]'::jsonb) into v_items
  from (
    select v.product_code, v.name, v.category_name, v.supplier_name, v.quantity_on_hand,
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

create or replace function public.rpc_report_stock_movements(
  p_from date default current_date, p_to date default current_date,
  p_product_id uuid default null, p_movement_type public.movement_type default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_summary jsonb;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select sm.created_at, sm.movement_type, sm.quantity, sm.reason,
           p.name as product_name, p.product_code, u.full_name as created_by_name,
           sm.reference_type, sm.reference_id, sm.unit_cost
    from public.stock_movements sm
    join public.products p on p.id = sm.product_id
    left join public.app_users u on u.id = sm.created_by
    where sm.created_at::date between p_from and p_to
      and (p_product_id is null or sm.product_id = p_product_id)
      and (p_movement_type is null or sm.movement_type = p_movement_type)
    limit 500) t;

  select coalesce(jsonb_object_agg(movement_type, qty), '{}'::jsonb) into v_summary from (
    select sm.movement_type::text as movement_type, sum(sm.quantity) as qty
    from public.stock_movements sm
    where sm.created_at::date between p_from and p_to
      and (p_product_id is null or sm.product_id = p_product_id)
    group by 1) x;

  return jsonb_build_object('from', p_from, 'to', p_to, 'items', v_items, 'summary', v_summary);
end $$;

create or replace function public.rpc_report_fifo_cogs(
  p_from date default current_date, p_to date default current_date
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select fa.created_at, p.name as product_name, s.name as supplier_name,
           b.batch_number, b.received_date, sa.sale_number,
           fa.quantity, fa.unit_cost, fa.total_cost, fa.direction,
           case when fa.quantity > 0 then public.fn_money(fa.total_cost / fa.quantity) else 0 end as effective_unit_cost
    from public.fifo_allocations fa
    join public.purchase_batches b on b.id = fa.batch_id
    join public.products p on p.id = fa.product_id
    join public.suppliers s on s.id = fa.supplier_id
    left join public.sales sa on sa.id = fa.sale_id
    where fa.created_at::date between p_from and p_to
    limit 500) t;

  select public.fn_money(coalesce(sum(total_cost) filter (where direction = 'OUT'), 0)) as cogs_out,
         public.fn_money(coalesce(sum(total_cost) filter (where direction = 'IN'), 0)) as reversed_in,
         count(*) as allocations
    into v_totals from public.fifo_allocations
   where created_at::date between p_from and p_to;

  return jsonb_build_object('from', p_from, 'to', p_to, 'items', v_items, 'totals', to_jsonb(v_totals));
end $$;

create or replace function public.rpc_report_supplier_payable(
  p_supplier_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_suppliers jsonb;
  v_lines jsonb;
  v_totals record;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.outstanding desc), '[]'::jsonb) into v_suppliers from (
    select supplier_code, name, total_payable, total_paid, outstanding, open_lines, last_activity
    from public.v_owner_supplier_balance
    where p_supplier_id is null or supplier_id = p_supplier_id) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.entry_date desc), '[]'::jsonb) into v_lines from (
    select sp.entry_date, s.name as supplier_name, p.name as product_name, b.batch_number,
           sp.quantity_sold, sp.purchase_cost, sp.payable_amount, sp.amount_paid, sp.outstanding,
           sp.status, sp.is_reversal
    from public.supplier_payables sp
    join public.suppliers s on s.id = sp.supplier_id
    join public.products p on p.id = sp.product_id
    join public.purchase_batches b on b.id = sp.purchase_batch_id
    where p_supplier_id is null or sp.supplier_id = p_supplier_id
    order by sp.entry_date desc limit 300) t;

  select public.fn_money(coalesce(sum(payable_amount), 0)) as payable,
         public.fn_money(coalesce(sum(amount_paid), 0)) as paid,
         public.fn_money(coalesce(sum(outstanding), 0)) as outstanding
    into v_totals from public.supplier_payables
   where p_supplier_id is null or supplier_id = p_supplier_id;

  return jsonb_build_object('suppliers', v_suppliers, 'lines', v_lines, 'totals', to_jsonb(v_totals));
end $$;

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
    select e.expense_number, e.expense_date, e.category, e.amount, e.payment_method,
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

create or replace function public.rpc_report_pnl(
  p_from date default (date_trunc('month', current_date) - interval '5 months')::date,
  p_to   date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_months jsonb;
  v_supplier_payments numeric;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.period_month desc), '[]'::jsonb) into v_months
  from (
    select period_month, gross_sales, discounts, returns, net_sales, cogs, gross_profit,
           operating_expenses, staff_commission, net_profit, tithe_due_10pct
    from public.v_pnl_monthly
    where period_month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date) t;

  -- Shown for transparency: supplier payments are a balance-sheet settlement.
  select public.fn_money(coalesce(sum(amount), 0)) into v_supplier_payments
  from public.supplier_payments
  where payment_date between p_from and p_to and voided_at is null;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'months', v_months,
    'formula', jsonb_build_object(
      'net_sales', 'Sales − Discounts − Returns',
      'gross_profit', 'Net Sales − COGS',
      'net_profit', 'Gross Profit − Operating Expenses − Staff Commission'),
    'supplier_payments_in_period', v_supplier_payments,
    'supplier_payments_note', 'Supplier payments settle a liability already recognised in COGS. They are NOT an operating expense and are excluded from net profit.'
  );
end $$;

create or replace function public.rpc_report_commission(
  p_from date default date_trunc('month', current_date)::date,
  p_to   date default current_date,
  p_staff_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff jsonb;
  v_lines jsonb;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.net_commission desc), '[]'::jsonb) into v_staff from (
    select u.id as staff_id, u.full_name, u.commission_rate,
           public.fn_money(coalesce(sum(c.amount) filter (where c.type = 'EARNED'), 0)) as earned,
           public.fn_money(coalesce(sum(c.amount) filter (where c.type in ('RETURN_REVERSAL','VOID_REVERSAL')), 0)) as reversals,
           public.fn_money(coalesce(sum(c.amount), 0)) as net_commission,
           public.fn_money(coalesce((select sum(cp.amount) from public.commission_payments cp
              where cp.staff_id = u.id), 0)) as paid,
           public.fn_money(coalesce(sum(c.amount), 0) -
             coalesce((select sum(cp.amount) from public.commission_payments cp where cp.staff_id = u.id), 0)) as outstanding
    from public.app_users u
    left join public.commissions c on c.staff_id = u.id and c.sale_date between p_from and p_to
    where u.role in ('STAFF','OWNER') and (p_staff_id is null or u.id = p_staff_id)
    group by u.id, u.full_name, u.commission_rate) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.sale_date desc), '[]'::jsonb) into v_lines from (
    select c.sale_date, u.full_name as staff_name, c.type, c.amount, c.rate,
           sa.sale_number, sa.total_amount, sa.discount_amount, c.note
    from public.commissions c
    left join public.app_users u on u.id = c.staff_id
    left join public.sales sa on sa.id = c.sale_id
    where c.sale_date between p_from and p_to and (p_staff_id is null or c.staff_id = p_staff_id)
    order by c.created_at desc limit 300) t;

  return jsonb_build_object('from', p_from, 'to', p_to, 'staff', v_staff, 'lines', v_lines);
end $$;

create or replace function public.rpc_report_returns(
  p_from date default date_trunc('month', current_date)::date,
  p_to   date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_returns jsonb;
  v_voids jsonb;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_returns from (
    select r.return_number, r.return_date, sa.sale_number, sa.status as sale_status,
           r.return_type, r.return_amount, r.cogs_reversed, r.restock_decision, r.reason,
           u.full_name as processed_by_name,
           (select count(*) from public.return_items ri where ri.return_id = r.id) as line_count
    from public.returns r
    join public.sales sa on sa.id = r.sale_id
    left join public.app_users u on u.id = r.processed_by
    where r.return_date between p_from and p_to) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.voided_at desc), '[]'::jsonb) into v_voids from (
    select sa.sale_number, sa.sale_date, sa.total_amount, sa.void_reason, sa.voided_at,
           u.full_name as voided_by_name
    from public.sales sa left join public.app_users u on u.id = sa.voided_by
    where sa.status = 'VOIDED' and sa.sale_date between p_from and p_to) t;

  return jsonb_build_object(
    'returns', v_returns, 'voids', v_voids,
    'note', 'Returns on a voided sale are shown in the void, not counted twice in the P&L.');
end $$;

create or replace function public.rpc_report_tithe(p_year int default extract(year from current_date)::int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  perform public.fn_require_owner();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.period_month desc), '[]'::jsonb) into v_items from (
    select p.period_month,
           coalesce(p.net_profit, 0) as net_profit,
           coalesce((select tr.tithe_rate from public.tithe_records tr where tr.period_month = p.period_month), 0.10) as tithe_rate,
           coalesce((select tr.tithe_amount from public.tithe_records tr where tr.period_month = p.period_month),
                    case when p.net_profit > 0 then public.fn_money(p.net_profit * 0.10) else 0 end) as tithe_amount,
           coalesce((select tr.status from public.tithe_records tr where tr.period_month = p.period_month), 'DUE') as status,
           (select tr.paid_date from public.tithe_records tr where tr.period_month = p.period_month) as paid_date,
           (select tr.payment_method from public.tithe_records tr where tr.period_month = p.period_month) as payment_method,
           (select tr.reference from public.tithe_records tr where tr.period_month = p.period_month) as reference
    from public.v_pnl_monthly p
    where extract(year from p.period_month) = p_year) t;

  return jsonb_build_object('year', p_year, 'months', v_items,
    'note', 'Tithe is 10% of net profit, paid monthly. A loss produces no tithe, and tithe is not an operating expense.');
end $$;

create or replace function public.rpc_report_customer_demand(
  p_days int default 90, p_only_unavailable boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  perform public.fn_require_internal();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.request_count desc), '[]'::jsonb) into v_items from (
    select coalesce(p.name, cr.requested_product_name) as product_name,
           cr.product_id,
           c.name as category,
           count(*) as request_count,
           count(distinct cr.customer_phone) as unique_customers,
           max(cr.created_at) as last_requested,
           min(cr.created_at) as first_requested,
           public.fn_on_hand(cr.product_id) as quantity_on_hand,
           public.fn_availability(public.fn_on_hand(cr.product_id), p.minimum_stock) as availability,
           coalesce(p.minimum_stock, 0) as minimum_stock,
           bool_or(cr.was_unavailable) as unavailable_request,
           format('%s customer%s %s requested this product.',
                  count(distinct cr.customer_phone),
                  case when count(distinct cr.customer_phone) = 1 then '' else 's' end,
                  case when count(distinct cr.customer_phone) = 1 then 'has' else 'have' end) as demand_message
    from public.customer_requests cr
    left join public.products p on p.id = cr.product_id
    left join public.categories c on c.id = coalesce(cr.category_id, p.category_id)
    where cr.status <> 'CANCELLED'
      and cr.created_at >= now() - make_interval(days => greatest(p_days, 1))
    group by cr.product_id, coalesce(p.name, cr.requested_product_name), c.name, p.minimum_stock) t;

  if p_only_unavailable then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_items) x
    where (x ->> 'availability') <> 'AVAILABLE';
  end if;

  return jsonb_build_object('days', p_days, 'items', coalesce(v_items, '[]'::jsonb));
end $$;

create or replace function public.rpc_report_customer_requests(
  p_from date default (current_date - 30),
  p_to   date default current_date,
  p_status public.request_status default null,
  p_source public.request_source default null,
  p_product_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_stats record;
begin
  perform public.fn_require_internal();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select cr.request_number as "requestNumber", cr.customer_name as "customerName",
           cr.customer_phone as "customerPhone", cr.requested_product_name as "product",
           cr.quantity, cr.status, cr.source, cr.was_unavailable, cr.created_at, cr.updated_at,
           p.name as matched_product, cr.owner_note, cr.message
    from public.customer_requests cr
    left join public.products p on p.id = cr.product_id
    where cr.created_at::date between p_from and p_to
      and (p_status is null or cr.status = p_status)
      and (p_source is null or cr.source = p_source)
      and (p_product_id is null or cr.product_id = p_product_id)
    order by cr.created_at desc limit 500) t;

  select count(*) as total,
         count(*) filter (where status = 'NEW') as new_count,
         count(*) filter (where status in ('FULFILLED')) as fulfilled,
         count(distinct customer_phone) as customers,
         count(*) filter (where was_unavailable) as unavailable
    into v_stats from public.customer_requests
   where created_at::date between p_from and p_to;

  return jsonb_build_object('from', p_from, 'to', p_to, 'items', v_items, 'stats', to_jsonb(v_stats));
end $$;


-- ===========================================================================
-- Purchase batches & receivings (owner-only)
-- ---------------------------------------------------------------------------
-- These tables carry purchase cost, so they are not granted to any client role
-- at all; the owner reaches them here. The same rows also drive the "record the
-- real cost" workflow after a staff shipment arrives unpriced, and the
-- «N customers have requested this product» prompt at purchasing time.
-- ===========================================================================
create or replace function public.rpc_list_batches(
  p_product_id        uuid default null,
  p_supplier_id       uuid default null,
  p_only_pending_cost boolean default false,
  p_limit             int default 200
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.received_date desc, t.created_at desc), '[]'::jsonb)
    into v_items
  from (
    select b.id, b.batch_number, b.received_date, b.created_at, b.expiry_date,
           p.name as product_name, p.product_code, p.selling_price,
           s.name as supplier_name, s.id as supplier_id,
           b.unit_cost, b.cost_status, b.quantity_received, b.quantity_remaining,
           b.quantity_sold, b.status as batch_status,
           public.fn_money(b.quantity_sold * b.unit_cost) as cost_of_units_sold,
           public.fn_money(b.quantity_remaining * b.unit_cost) as value_remaining,
           case when b.unit_cost > 0
                then public.fn_money(p.selling_price - b.unit_cost) end as unit_margin,
           b.notes,
           -- demand signal, so purchasing decisions are informed (spec §13)
           (select count(*) from public.customer_requests cr
             where cr.product_id = b.product_id and cr.status <> 'CANCELLED') as request_count,
           (select count(*) from public.customer_requests cr
             where cr.product_id = b.product_id and cr.status <> 'CANCELLED') as customers_requested
    from public.purchase_batches b
    join public.products p on p.id = b.product_id
    join public.suppliers s on s.id = b.supplier_id
    where (p_product_id is null or b.product_id = p_product_id)
      and (p_supplier_id is null or b.supplier_id = p_supplier_id)
      and (not p_only_pending_cost or b.cost_status = 'PENDING')
    order by b.received_date desc, b.created_at desc
    limit greatest(coalesce(p_limit, 200), 1)) t;

  return jsonb_build_object('items', v_items,
    'pending_cost_count', (select count(*) from public.purchase_batches where cost_status = 'PENDING'));
end $$;

create or replace function public.rpc_list_restocks(
  p_only_pending_cost boolean default false,
  p_limit int default 200
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.received_date desc), '[]'::jsonb) into v_items
  from (
    select r.id, r.restock_number, r.received_date, r.expiry_date, r.quantity,
           r.unit_cost, r.cost_pending, r.cost_flagged, r.previous_unit_cost,
           r.supplier_invoice, r.notes, r.batch_id, r.status,
           p.name as product_name, p.product_code, s.name as supplier_name,
           u.full_name as received_by_name,
           case when r.cost_flagged and r.unit_cost is not null and r.previous_unit_cost is not null
                then format('Purchase cost changed from %s to %s. Selling price was NOT changed.',
                            to_char(r.previous_unit_cost, 'FM999,990.00'),
                            to_char(r.unit_cost, 'FM999,990.00')) end as cost_change_warning
    from public.restocks r
    join public.products p on p.id = r.product_id
    join public.suppliers s on s.id = r.supplier_id
    left join public.app_users u on u.id = r.received_by
    where (not p_only_pending_cost or r.cost_pending)
    order by r.received_date desc, r.created_at desc
    limit greatest(coalesce(p_limit, 200), 1)) t;

  return jsonb_build_object('items', v_items);
end $$;
