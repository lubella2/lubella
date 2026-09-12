-- ============================================================================
-- LuBella  |  Migration 0014 — Customer portal RPCs (open to `anon`)
-- ============================================================================
-- Customers never register. The public write surface is exactly ONE function,
-- and it deliberately cannot touch inventory: a WhatsApp/Telegram order is a
-- REQUEST, and stock only ever leaves through rpc_complete_sale (spec §9, §60).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Public catalog search. Server-side filtering so the browser never needs a
-- broad table grant and the catalog stays fast on a phone.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_public_catalog(
  p_search      text default null,
  p_category_id uuid default null,
  p_brand       text default null,
  p_featured    boolean default null,
  p_limit       int default 60,
  p_offset      int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_total int;
begin
  with filtered as (
    select pp.*
    from public.public_products pp
    where (p_category_id is null or pp.category_id = p_category_id)
      and (p_brand is null or pp.brand = p_brand)
      and (p_featured is null or pp.featured = p_featured)
      and (
        p_search is null or btrim(p_search) = ''
        or pp.name ilike '%' || btrim(p_search) || '%'
        or coalesce(pp.brand, '')     ilike '%' || btrim(p_search) || '%'
        or coalesce(pp.keywords, '')  ilike '%' || btrim(p_search) || '%'
        or coalesce(pp.description, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(pp.category_name, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(pp.product_code, '') ilike '%' || btrim(p_search) || '%'
      )
  )
  select coalesce(jsonb_agg(to_jsonb(f) order by
           case when p_featured is true then f.featured end desc nulls last,
           case f.availability when 'AVAILABLE' then 0 when 'LOW' then 1 else 2 end,
           f.created_at desc), '[]'::jsonb),
         count(*)
    into v_items, v_total
  from (select * from filtered order by created_at desc
        limit greatest(coalesce(p_limit, 60), 1) offset greatest(coalesce(p_offset, 0), 0)) f;

  return jsonb_build_object('items', v_items, 'count', v_total,
                            'limit', p_limit, 'offset', p_offset);
end $$;

-- Brands and categories for the filter bar.
create or replace function public.rpc_public_filters()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug, 'product_count', c.product_count)
        order by c.sort_order, c.name)
      from public.public_categories c), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(distinct b) from (
        select b from (select distinct brand as b from public.public_products where brand is not null) x
        order by b) y), '[]'::jsonb),
    'settings', public.fn_public_settings()
  );
$$;

-- ---------------------------------------------------------------------------
-- Building an order message. Server-side so the WhatsApp number lives in
-- settings, never in a component (spec §14).
-- ---------------------------------------------------------------------------
create or replace function public.rpc_build_order_message(
  p_items jsonb,               -- [{"product_id":"…","quantity":2}, …]
  p_customer_name text default null,
  p_customer_phone text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_line  record;
  v_msg   text;
  v_links jsonb;
begin
  for v_line in
    select pp.id, pp.name, pp.selling_price, pp.availability,
           greatest(sum((e ->> 'quantity')::int), 0) as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    join public.public_products pp on pp.id = (e ->> 'product_id')::uuid
    group by pp.id, pp.name, pp.selling_price, pp.availability
    order by pp.name
  loop
    continue when v_line.quantity <= 0;
    v_items := v_items || jsonb_build_object(
      'product_id', v_line.id, 'name', v_line.name, 'quantity', v_line.quantity,
      'unit_price', v_line.selling_price,
      'line_total', public.fn_money(v_line.quantity * v_line.selling_price),
      'availability', v_line.availability
    );
    -- The estimate is shown to the customer but is explicitly not a confirmed
    -- price; stock is not reserved or deducted at this point.
    v_total := v_total + public.fn_money(v_line.quantity * v_line.selling_price);
  end loop;

  v_msg := public.fn_build_order_message(v_items, v_total, p_customer_name, p_customer_phone, 'ORDER');
  v_links := public.fn_contact_links(v_msg);

  return jsonb_build_object(
    'items', v_items,
    'estimated_total', public.fn_money(v_total),
    'estimate_note', 'This total is an estimate only until LuBella confirms your order.',
    'message', v_msg,
    'links', v_links
  );
end $$;

-- ---------------------------------------------------------------------------
-- rpc_submit_customer_request — the single public write path.
-- Records demand (including for products we do not stock at all) and returns
-- ready-to-send WhatsApp/Telegram links. It NEVER touches stock.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_submit_customer_request(
  p_requested_product_name text,
  p_quantity               int default 1,
  p_customer_name          text default null,
  p_customer_phone         text default null,
  p_product_id             uuid default null,
  p_message                text default null,
  p_photo_url              text default null,
  p_source                 public.request_source default 'WEBSITE'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_number   text;
  v_prod     public.products;
  v_available int;
  v_unavail  boolean := false;
  v_links    jsonb;
  v_msg      text;
  v_hash     text;
  v_recent   int;
begin
  if p_requested_product_name is null or btrim(p_requested_product_name) = '' then
    raise exception 'PRODUCT_REQUIRED: tell us which product you would like' using errcode = '22023';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'QUANTITY_INVALID: quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_customer_phone is null or length(regexp_replace(p_customer_phone, '[^0-9]', '', 'g')) < 7 then
    raise exception 'PHONE_REQUIRED: a phone number is needed so LuBella can reach you' using errcode = '22023';
  end if;

  -- Light anti-spam guard on a public endpoint: 5 requests per phone per hour.
  -- md5 (pg_catalog, always available) rather than pgcrypto's digest(): RPCs pin
  -- search_path to public+pg_temp, so a function living in the `extensions`
  -- schema is not resolvable. This is a privacy measure — the rate-limit table
  -- stores a one-way key, never the customer's phone number — not a password
  -- hash, so md5's properties are sufficient here.
  v_hash := md5(regexp_replace(p_customer_phone, '[^0-9]', '', 'g'));
  select count(*) into v_recent from public.request_rate_limit
   where phone_hash = v_hash and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'RATE_LIMITED: too many requests from this number. Please contact LuBella directly.'
      using errcode = '22023';
  end if;
  insert into public.request_rate_limit (phone_hash) values (v_hash);

  if p_product_id is not null then
    select * into v_prod from public.products where id = p_product_id;
    if found then
      v_available := public.fn_on_hand(p_product_id);
      v_unavail := v_available <= 0
                   or (v_prod.expiry_date is not null and v_prod.expiry_date < current_date);
    end if;
  end if;

  v_number := public.fn_next_number('CR', 4);

  insert into public.customer_requests (
    request_number, customer_name, customer_phone, product_id, requested_product_name,
    quantity, message, photo_url, source, was_unavailable, category_id
  ) values (
    v_number, p_customer_name, p_customer_phone, p_product_id, btrim(p_requested_product_name),
    p_quantity, p_message, p_photo_url, p_source, v_unavail,
    case when p_product_id is not null then (select category_id from public.products where id = p_product_id) end
  ) returning id into v_id;

  v_msg := public.fn_build_order_message(
    jsonb_build_array(jsonb_build_object('name', btrim(p_requested_product_name), 'quantity', p_quantity)),
    null, p_customer_name, p_customer_phone, 'REQUEST');
  v_links := public.fn_contact_links(v_msg);

  -- NOTE: no stock movement is written here. Inventory is only ever reduced by
  -- rpc_complete_sale (spec §9).
  return jsonb_build_object(
    'request_id', v_id, 'request_number', v_number,
    'was_unavailable', v_unavail,
    'message', v_msg, 'links', v_links
  );
end $$;

-- ---------------------------------------------------------------------------
-- Customer request management (internal)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_update_request_status(
  p_request_id uuid,
  p_status     public.request_status,
  p_note       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.customer_requests;
  v_user public.app_users;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_internal();

  select * into v_req from public.customer_requests where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND: no request with id %', p_request_id using errcode = '23503';
  end if;

  update public.customer_requests
     set status = p_status, owner_note = coalesce(p_note, owner_note)
   where id = p_request_id;

  perform public.fn_audit('CUSTOMER_REQUEST_STATUS', 'customer_requests', p_request_id,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', p_status, 'note', p_note,
                       'request_number', v_req.request_number,
                       'changed_by', v_user.full_name));

  return jsonb_build_object('request_id', p_request_id, 'request_number', v_req.request_number,
                            'status', p_status);
end $$;

-- Who asked for a product that is not on the shelf — used to prompt the owner
-- at purchasing time: «12 customers have requested this product.»
create or replace function public.rpc_demand_for_product(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'request_count', count(*),
    'unique_customers', count(distinct cr.customer_phone),
    'last_requested', max(cr.created_at),
    'message', count(*) || ' customer' || case when count(*) = 1 then '' else 's' end ||
               ' have requested this product.'
  )
  from public.customer_requests cr
  where cr.product_id = p_product_id
    and cr.status <> 'CANCELLED';
$$;
