-- ============================================================================
-- LuBella  |  Migration 0021 — Statement listing + demand drill-down
-- ============================================================================
-- Two read RPCs the Owner screens need:
--   rpc_list_supplier_statements — generated statements, newest month first.
--     `supplier_statements` is an owner-only table and is deliberately NOT
--     granted to `authenticated`, so the Owner UI cannot read it directly; it
--     comes through this definer function exactly like the other owner data.
--   rpc_request_detail — one customer request with its full history.
--
-- Numbered below 9999 so the API-surface grants still run last. New functions
-- inherit EXECUTE for PUBLIC at creation, which 9999 then closes; the
-- anon-surface assertion in 03_security_rls.sql is the tripwire if that order
-- is ever broken.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Supplier statements (owner). Recomputed totals only — nothing typed in.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_list_supplier_statements(
  p_supplier_id uuid default null,
  p_limit       int  default 100
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.period_month desc), '[]'::jsonb) into v_items
  from (
    select st.id, st.statement_number, st.period_month, st.opening_outstanding,
           st.units_sold, st.total_payable, st.total_paid, st.outstanding,
           st.generated_at,
           s.name as supplier_name, s.supplier_code, s.contact_name, s.phone, s.email,
           u.full_name as generated_by_name
    from public.supplier_statements st
    join public.suppliers s on s.id = st.supplier_id
    left join public.app_users u on u.id = st.generated_by
    where (p_supplier_id is null or st.supplier_id = p_supplier_id)
    order by st.period_month desc
    limit greatest(coalesce(p_limit, 100), 1)) t;

  return jsonb_build_object('items', v_items);
end $$;

-- ---------------------------------------------------------------------------
-- Internal supplier notes (owner). `supplier_internal_notes` holds notes that
-- are for the owner's eyes only and carries no grant, so it is read through
-- this definer wrapper for the same reason statements are.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_list_supplier_notes(
  p_supplier_id uuid,
  p_limit       int default 50
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

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items
  from (
    select n.id, n.supplier_id, n.note, n.created_at,
           u.full_name as created_by_name
    from public.supplier_internal_notes n
    left join public.app_users u on u.id = n.created_by
    where n.supplier_id = p_supplier_id
    order by n.created_at desc
    limit greatest(coalesce(p_limit, 50), 1)) t;

  return jsonb_build_object('items', v_items);
end $$;

-- ---------------------------------------------------------------------------
-- One customer request in full (owner / staff). Used by the Requests screen
-- when a card is opened, so the phone number is only fetched on demand and
-- only for an internal caller.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_request_detail(
  p_request_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
begin
  perform public.fn_require_internal();

  select to_jsonb(t) into v_row
  from (
    select cr.id, cr.request_number, cr.customer_name, cr.customer_phone,
           cr.requested_product_name, cr.quantity, cr.message, cr.photo_url,
           cr.source, cr.status, cr.was_unavailable, cr.owner_note,
           cr.status_history, cr.created_at, cr.updated_at,
           cr.product_id, p.name as product_name, p.product_code,
           p.selling_price as product_price, c.name as category_name,
           public.fn_availability(
             public.fn_staff_on_hand(p.id), p.minimum_stock) as availability,
           public.fn_staff_on_hand(p.id) as quantity_on_hand,
           u.full_name as handled_by_name,
           (select count(*) from public.customer_requests x
             where x.requested_product_name = cr.requested_product_name) as same_product_requests,
           (select count(*) from public.customer_requests x
             where cr.customer_phone is not null
               and x.customer_phone = cr.customer_phone) as same_customer_requests
    from public.customer_requests cr
    left join public.products p   on p.id = cr.product_id
    left join public.categories c on c.id = cr.category_id
    left join public.app_users u  on u.id = cr.handled_by
    where cr.id = p_request_id) t;

  if v_row is null then
    raise exception 'REQUEST_NOT_FOUND: no customer request with that id' using errcode = 'P0001';
  end if;

  return v_row;
end $$;
