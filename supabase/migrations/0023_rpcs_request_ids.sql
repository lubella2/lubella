-- ============================================================================
-- LuBella  |  Migration 0023 — Request identity in the request report
-- ============================================================================
-- The customer-request report listed everything an owner reads but omitted the
-- request's id, so the Requests screen could not act on a row without a second
-- lookup. The id is added (aliased to `id`, alongside the existing camelCase
-- keys the UI already consumes) and nothing else changes.
--
-- Numbered below 9999 so the API-surface grants still run last.
-- ============================================================================

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
    select cr.id, cr.request_number as "requestNumber", cr.customer_name as "customerName",
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
