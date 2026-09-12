-- ============================================================================
-- LuBella  |  Migration 0019 — Sale detail & own-sales (role-aware payloads)
-- ============================================================================
-- Appended rather than folded into 0016 because migrations are append-only once
-- they have been applied.
--
-- rpc_sale_detail is the clearest expression of the cost-visibility rule: it
-- returns cogs_amount, gross_profit and per-line costs ONLY when the caller is
-- the owner. A staff member receives their own sale with those keys set to null
-- — the field is absent from the data, not merely hidden in the UI, so a staff
-- token cannot read cost even by calling this function directly.
-- ============================================================================

create or replace function public.rpc_sale_detail(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_owner boolean := public.fn_is_owner();
  v_sale     public.sales;
  v_items    jsonb;
  v_returns  jsonb;
  v_comm     jsonb;
begin
  perform public.fn_require_internal();

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'SALE_NOT_FOUND: no sale with id %', p_sale_id using errcode = '23503';
  end if;

  -- Staff may open only their own sales; the owner may open any.
  if not v_is_owner and v_sale.staff_id <> auth.uid() then
    raise exception 'NOT_YOUR_SALE: this sale belongs to another staff member' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.product_name), '[]'::jsonb) into v_items
  from (
    select si.id, si.product_id, p.name as product_name, p.product_code,
           si.quantity, si.unit_price, si.line_subtotal, si.line_discount, si.line_total,
           si.returned_qty, si.refunded_amount,
           -- cost fields are present for the owner and null for everyone else
           case when v_is_owner then si.unit_cogs end as unit_cogs,
           case when v_is_owner then si.line_cogs end as line_cogs
    from public.sale_items si
    join public.products p on p.id = si.product_id
    where si.sale_id = p_sale_id) t;

  if v_is_owner then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.return_date desc), '[]'::jsonb) into v_returns
    from (
      select r.id, r.return_number, r.return_date, r.return_type, r.return_amount,
             r.cogs_reversed, r.restock_decision, r.reason, r.processed_by
      from public.returns r where r.sale_id = p_sale_id) t;
  else
    v_returns := '[]'::jsonb;
  end if;

  -- Commission rows for this sale belong to the seller, so a staff member may
  -- see their own; the owner sees all.
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb) into v_comm
  from (
    select c.id, c.type, c.amount, c.rate, c.sale_date, c.staff_id, c.created_at
    from public.commissions c
    where c.sale_id = p_sale_id
      and (v_is_owner or c.staff_id = auth.uid())) t;

  return jsonb_build_object(
    'sale', jsonb_build_object(
      'id', v_sale.id, 'sale_number', v_sale.sale_number, 'sale_date', v_sale.sale_date,
      'created_at', v_sale.created_at, 'subtotal', v_sale.subtotal,
      'discount_amount', v_sale.discount_amount, 'discount_percent', v_sale.discount_percent,
      'total_amount', v_sale.total_amount, 'returned_amount', v_sale.returned_amount,
      'payment_method', v_sale.payment_method, 'status', v_sale.status,
      'staff_id', v_sale.staff_id,
      'staff_name', (select full_name from public.app_users where id = v_sale.staff_id),
      'cogs_amount', case when v_is_owner then v_sale.cogs_amount end,
      'gross_profit', case when v_is_owner then v_sale.gross_profit end,
      'void_reason', v_sale.void_reason, 'voided_at', v_sale.voided_at,
      'can_return', v_is_owner and v_sale.status <> 'VOIDED'
    ),
    'items', v_items,
    'returns', v_returns,
    'commissions', v_comm,
    'cost_visible', v_is_owner,
    'note', case when v_is_owner then null
                 else 'Purchase cost and profit are not shown for staff accounts.' end
  );
end $$;

-- Own sales history for the staff "My Sales" page. No cost fields at all.
create or replace function public.rpc_my_sales(
  p_limit int default 50,
  p_from  date default null,
  p_to    date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_items jsonb;
  v_totals record;
  v_month_start date := date_trunc('month', current_date)::date;
begin
  perform public.fn_require_internal();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items
  from (
    select sa.id, sa.sale_number, sa.sale_date, sa.created_at,
           sa.subtotal, sa.discount_amount, sa.total_amount, sa.returned_amount,
           public.fn_money(sa.total_amount - sa.returned_amount) as net_amount,
           sa.payment_method, sa.status,
           (select count(*) from public.sale_items si where si.sale_id = sa.id) as line_count
    from public.sales sa
    where sa.staff_id = v_uid
      and (p_from is null or sa.sale_date >= p_from)
      and (p_to   is null or sa.sale_date <= p_to)
    order by sa.created_at desc
    limit greatest(coalesce(p_limit, 50), 1)) t;

  select
    count(*) as sale_count,
    public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) as net_sales,
    public.fn_money(coalesce(sum(discount_amount), 0)) as discounts
    into v_totals
  from public.sales
  where staff_id = v_uid and status <> 'VOIDED'
    and sale_date >= v_month_start
    and (p_from is null or sale_date >= p_from)
    and (p_to   is null or sale_date <= p_to);

  return jsonb_build_object(
    'items', v_items,
    'month_totals', jsonb_build_object(
      'sale_count', v_totals.sale_count,
      'net_sales', v_totals.net_sales,
      'discounts', v_totals.discounts,
      'commission', (select public.fn_money(coalesce(sum(amount), 0)) from public.commissions
                      where staff_id = v_uid and sale_date >= v_month_start)
    )
  );
end $$;

-- My commission ledger, with the EARNED / reversal split the spec calls for.
create or replace function public.rpc_my_commission(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_items    jsonb;
  v_totals   jsonb;
  v_payments jsonb;
  v_paid     numeric;
begin
  perform public.fn_require_internal();

  -- The full ledger, including reversal rows, so a staff member can see exactly
  -- why their commission changed (§36: original records are never deleted).
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items
  from (
    select c.id, c.sale_date, c.type, c.amount, c.rate, c.note, c.created_at,
           sa.sale_number, sa.total_amount as sale_total, sa.discount_amount as sale_discount,
           r.return_number
    from public.commissions c
    left join public.sales sa on sa.id = c.sale_id
    left join public.returns r on r.id = c.return_id
    where c.staff_id = v_uid
      and (p_from is null or c.sale_date >= p_from)
      and (p_to   is null or c.sale_date <= p_to)) t;

  select jsonb_build_object(
           'earned',   public.fn_money(coalesce(sum(amount) filter (where type = 'EARNED'), 0)),
           'reversed', public.fn_money(coalesce(sum(amount) filter (where type in ('RETURN_REVERSAL','VOID_REVERSAL')), 0)),
           'net',      public.fn_money(coalesce(sum(amount), 0)))
    into v_totals
  from public.commissions where staff_id = v_uid;

  select public.fn_money(coalesce(sum(amount), 0)),
         coalesce(jsonb_agg(jsonb_build_object(
           'payment_number', payment_number, 'amount', amount, 'payment_date', payment_date,
           'reference', reference, 'period_start', period_start, 'period_end', period_end)
           order by payment_date desc), '[]'::jsonb)
    into v_paid, v_payments
  from public.commission_payments where staff_id = v_uid;

  return jsonb_build_object(
    'items', v_items,
    'totals', v_totals,
    'payments', jsonb_build_object('paid', v_paid, 'entries', v_payments),
    'outstanding', public.fn_money((v_totals ->> 'net')::numeric - v_paid)
  );
end $$;
