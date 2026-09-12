-- ============================================================================
-- LuBella  |  Migration 0012 — Inventory RPCs
-- ============================================================================
-- Restocking, cost recording, adjustments and the biweekly stock count cycle.
-- ============================================================================

-- ===========================================================================
-- rpc_create_product / rpc_update_product  (owner only)
-- ===========================================================================
create or replace function public.rpc_create_product(
  p_name          text,
  p_selling_price numeric,
  p_category_id   uuid default null,
  p_brand         text default null,
  p_supplier_id   uuid default null,
  p_image_url     text default null,
  p_minimum_stock int  default 5,
  p_expiry_date   date default null,
  p_description   text default null,
  p_keywords      text default null,
  p_featured      boolean default false,
  p_opening_stock int default 0,
  p_opening_cost  numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  public.app_users;
  v_id    uuid;
  v_code  text;
  v_batch uuid;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  if p_name is null or btrim(p_name) = '' then
    raise exception 'NAME_REQUIRED: a product needs a name' using errcode = '22023';
  end if;
  if p_selling_price is null or p_selling_price < 0 then
    raise exception 'PRICE_INVALID: selling price must be zero or greater' using errcode = '22023';
  end if;

  v_code := public.fn_next_number('P', 4);

  insert into public.products (product_code, name, category_id, brand, supplier_id, image_url,
                               selling_price, minimum_stock, expiry_date, description, keywords,
                               featured, created_by)
  values (v_code, btrim(p_name), p_category_id, p_brand, p_supplier_id, p_image_url,
          public.fn_money(p_selling_price), greatest(coalesce(p_minimum_stock, 0), 0),
          p_expiry_date, p_description, p_keywords, coalesce(p_featured, false), v_user.id)
  returning id into v_id;

  -- Optional opening stock: recorded as a costed batch, never as a loose number.
  if coalesce(p_opening_stock, 0) > 0 then
    if p_supplier_id is null then
      raise exception 'SUPPLIER_REQUIRED: opening stock must name the supplier it came from'
        using errcode = '22023';
    end if;
    v_batch := public.fn_create_batch(v_id, p_supplier_id, p_opening_stock,
                                      coalesce(p_opening_cost, 0), p_expiry_date,
                                      current_date, 'Opening stock', v_user.id);
  end if;

  perform public.fn_audit('PRODUCT_CREATE', 'products', v_id, null,
    jsonb_build_object('product_code', v_code, 'name', p_name,
                       'selling_price', p_selling_price, 'opening_stock', p_opening_stock));

  return jsonb_build_object('product_id', v_id, 'product_code', v_code,
                            'batch_id', v_batch,
                            'quantity_on_hand', public.fn_on_hand(v_id));
end $$;

create or replace function public.rpc_update_product(
  p_product_id    uuid,
  p_name          text default null,
  p_selling_price numeric default null,
  p_category_id   uuid default null,
  p_brand         text default null,
  p_supplier_id   uuid default null,
  p_image_url     text default null,
  p_minimum_stock int default null,
  p_expiry_date   date default null,
  p_description   text default null,
  p_keywords      text default null,
  p_featured      boolean default null,
  p_active        boolean default null,
  p_is_public     boolean default null,
  p_reason        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.products;
  v_after  public.products;
begin
  perform public.fn_require_owner();

  select * into v_before from public.products where id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND: no product with id %', p_product_id using errcode = '23503';
  end if;

  -- NOTE: a selling-price change never touches historical sales, COGS or FIFO.
  -- Batches and sale_items carry their own frozen prices/costs.
  update public.products
     set name          = coalesce(p_name, name),
         selling_price = coalesce(public.fn_money(p_selling_price), selling_price),
         category_id   = coalesce(p_category_id, category_id),
         brand         = coalesce(p_brand, brand),
         supplier_id   = coalesce(p_supplier_id, supplier_id),
         image_url     = coalesce(p_image_url, image_url),
         minimum_stock = coalesce(p_minimum_stock, minimum_stock),
         expiry_date   = coalesce(p_expiry_date, expiry_date),
         description   = coalesce(p_description, description),
         keywords      = coalesce(p_keywords, keywords),
         featured      = coalesce(p_featured, featured),
         active        = coalesce(p_active, active),
         is_public     = coalesce(p_is_public, is_public)
   where id = p_product_id
  returning * into v_after;

  if v_after.selling_price is distinct from v_before.selling_price then
    update public.product_price_history set reason = p_reason
     where id = (select max(id) from public.product_price_history where product_id = p_product_id);
    perform public.fn_audit('SELLING_PRICE_CHANGE', 'products', p_product_id,
      jsonb_build_object('selling_price', v_before.selling_price),
      jsonb_build_object('selling_price', v_after.selling_price, 'reason', p_reason));
  end if;

  if v_after.image_url is distinct from v_before.image_url then
    perform public.fn_audit('PRODUCT_IMAGE_CHANGE', 'products', p_product_id,
      jsonb_build_object('image_url', v_before.image_url),
      jsonb_build_object('image_url', v_after.image_url));
  end if;

  perform public.fn_audit('PRODUCT_UPDATE', 'products', p_product_id,
    to_jsonb(v_before) - 'created_at' - 'updated_at',
    to_jsonb(v_after)  - 'created_at' - 'updated_at');

  return jsonb_build_object('product_id', p_product_id, 'selling_price', v_after.selling_price);
end $$;

-- ===========================================================================
-- fn_create_batch — internal helper. One received shipment = one batch.
-- ===========================================================================
create or replace function public.fn_create_batch(
  p_product_id   uuid,
  p_supplier_id  uuid,
  p_quantity     int,
  p_unit_cost    numeric,
  p_expiry_date  date,
  p_received_date date,
  p_notes        text,
  p_created_by   uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid;
  v_number   text;
  v_cost     numeric := public.fn_money(coalesce(p_unit_cost, 0));
begin
  v_number := public.fn_next_number('B', 6);

  insert into public.purchase_batches (
    batch_number, product_id, supplier_id, unit_cost, cost_status, quantity_received,
    quantity_remaining, quantity_sold, expiry_date, received_date, received_by, notes
  ) values (
    v_number, p_product_id, p_supplier_id, v_cost,
    case when v_cost > 0 then 'RECORDED'::public.cost_status else 'PENDING'::public.cost_status end,
    p_quantity, p_quantity, 0, p_expiry_date, coalesce(p_received_date, current_date),
    p_created_by, p_notes
  ) returning id into v_batch_id;

  insert into public.purchase_cost_history (batch_id, product_id, supplier_id, old_cost, new_cost, reason, changed_by)
  values (v_batch_id, p_product_id, p_supplier_id, null, v_cost,
          case when v_cost > 0 then 'Initial cost on receipt' else 'Received without a cost — owner must record it' end,
          p_created_by);

  return v_batch_id;
end $$;

-- ===========================================================================
-- rpc_record_restock — spec §27.
-- Staff may select an existing product and supplier and enter a quantity.
-- Staff NEVER enter a cost: when staff call this, the batch is created with
-- cost 0 and cost_status PENDING, and the owner is flagged. The owner's call
-- may include the cost. Either way a new purchase batch is created and a
-- RESTOCK movement is written; the selling price is never changed here.
-- ===========================================================================
create or replace function public.rpc_record_restock(
  p_product_id    uuid,
  p_supplier_id   uuid,
  p_quantity      int,
  p_received_date date default current_date,
  p_expiry_date   date default null,
  p_supplier_invoice text default null,
  p_notes         text default null,
  p_unit_cost     numeric default null      -- ignored for staff; owner only
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       public.app_users;
  v_batch_id   uuid;
  v_restock_id uuid;
  v_number     text;
  v_last_cost  numeric;
  v_flag       boolean := false;
  v_use_cost   numeric := null;
  v_prod       public.products;
  v_supplier   public.suppliers;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_internal();

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'QUANTITY_INVALID: quantity received must be greater than zero' using errcode = '22023';
  end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND: no product with id %', p_product_id using errcode = '23503';
  end if;

  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND: no supplier with id %', p_supplier_id using errcode = '23503';
  end if;

  -- Last known cost for this product+supplier, used only to raise a flag.
  select b.unit_cost into v_last_cost
  from public.purchase_batches b
  where b.product_id = p_product_id and b.supplier_id = p_supplier_id and b.cost_status = 'RECORDED'
  order by b.received_date desc, b.created_at desc limit 1;

  -- The owner may supply a cost on receipt. Staff may not, even if they try —
  -- the parameter is ignored for non-owners and the batch is left PENDING,
  -- which is what raises the review flag.
  if v_user.role = 'OWNER' and p_unit_cost is not null then
    v_use_cost := public.fn_money(p_unit_cost);
    if v_last_cost is not null and v_use_cost is distinct from v_last_cost then
      v_flag := true;
    end if;
  end if;

  v_batch_id := public.fn_create_batch(p_product_id, p_supplier_id, p_quantity,
                                       coalesce(v_use_cost, 0), p_expiry_date,
                                       p_received_date, p_notes, v_user.id);

  v_number := public.fn_next_number('RST', 6);

  insert into public.restocks (restock_number, batch_id, product_id, supplier_id, quantity,
                               unit_cost, received_date, expiry_date, supplier_invoice, notes,
                               cost_pending, cost_flagged, previous_unit_cost, received_by)
  values (v_number, v_batch_id, p_product_id, p_supplier_id, p_quantity, v_use_cost,
          coalesce(p_received_date, current_date), p_expiry_date, p_supplier_invoice, p_notes,
          v_use_cost is null, v_flag,
          case when v_flag then v_last_cost end, v_user.id)
  returning id into v_restock_id;

  insert into public.stock_movements (product_id, movement_type, quantity, unit_cost, reference_type,
                                      reference_id, batch_id, reason, created_by)
  values (p_product_id, 'RESTOCK', p_quantity, v_use_cost, 'restock', v_restock_id, v_batch_id,
          'Restock ' || v_number || ' from ' || v_supplier.name, v_user.id);

  -- Expiry on the batch/restock updates the product's earliest expiry if sooner.
  if p_expiry_date is not null and (v_prod.expiry_date is null or p_expiry_date < v_prod.expiry_date) then
    update public.products set expiry_date = p_expiry_date where id = p_product_id;
  end if;

  perform public.fn_audit('RESTOCK', 'restocks', v_restock_id, null,
    jsonb_build_object('restock_number', v_number, 'product', v_prod.name,
                       'supplier', v_supplier.name, 'quantity', p_quantity,
                       'unit_cost_recorded', v_use_cost is not null,
                       'cost_flagged', v_flag, 'previous_unit_cost', v_last_cost,
                       'new_unit_cost', v_use_cost));

  return jsonb_build_object(
    'restock_id', v_restock_id, 'restock_number', v_number, 'batch_id', v_batch_id,
    'quantity_on_hand', public.fn_on_hand(p_product_id),
    'cost_pending', v_use_cost is null,
    'cost_flagged', v_flag,
    'cost_review_message', case when v_use_cost is null
      then 'This shipment was received without a purchase cost. The owner must record it before payables are final.'
      when v_flag then format('Purchase cost for %s from %s changed from %s to %s. Selling price was NOT changed — review it.',
                              v_prod.name, v_supplier.name, to_char(v_last_cost, 'FM999,990.00'),
                              to_char(v_use_cost, 'FM999,990.00'))
      else null end
  );
end $$;

-- ===========================================================================
-- rpc_record_batch_cost — the owner's "review actual purchase cost" step.
-- ===========================================================================
create or replace function public.rpc_record_batch_cost(
  p_batch_id uuid,
  p_unit_cost numeric,
  p_reason   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.purchase_batches;
  v_restock public.restocks;
  v_user public.app_users;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'COST_INVALID: unit cost must be zero or greater' using errcode = '22023';
  end if;

  select * into v_batch from public.purchase_batches where id = p_batch_id for update;
  if not found then
    raise exception 'BATCH_NOT_FOUND: no batch with id %', p_batch_id using errcode = '23503';
  end if;

  insert into public.purchase_cost_history (batch_id, product_id, supplier_id, old_cost, new_cost, reason, changed_by)
  values (v_batch.id, v_batch.product_id, v_batch.supplier_id,
          case when v_batch.cost_status = 'RECORDED' then v_batch.unit_cost end,
          public.fn_money(p_unit_cost),
          coalesce(p_reason, 'Owner recorded the purchase cost for this shipment'), v_user.id);

  update public.purchase_batches
     set unit_cost = public.fn_money(p_unit_cost), cost_status = 'RECORDED'
   where id = p_batch_id;

  select * into v_restock from public.restocks where batch_id = p_batch_id;
  if found then
    update public.restocks
       set unit_cost = public.fn_money(p_unit_cost), cost_pending = false
     where id = v_restock.id;
  end if;

  -- Payables already recognised from this batch at a PENDING (zero) cost have
  -- to be brought up to the real cost. History is never deleted: the payable
  -- row is corrected and the correction is audit-logged.
  update public.supplier_payables
     set purchase_cost  = public.fn_money(p_unit_cost),
         payable_amount = public.fn_money(quantity_sold * p_unit_cost),
         outstanding    = public.fn_money(quantity_sold * p_unit_cost - amount_paid),
         status         = case
                            when public.fn_money(quantity_sold * p_unit_cost - amount_paid) <= 0
                              then 'PAID'::public.payable_status
                            when amount_paid > 0 then 'PARTIAL'::public.payable_status
                            else 'UNPAID'::public.payable_status end
   where purchase_batch_id = p_batch_id and is_reversal = false;

  -- Recompute the COGS of any sale that consumed this batch, so the P&L stays
  -- true. sale_items.unit_cogs / line_cogs and the parent sale are refreshed
  -- from the fifo_allocations rows, which are the source of truth.
  update public.fifo_allocations set unit_cost = public.fn_money(p_unit_cost)
   where batch_id = p_batch_id;
  update public.fifo_allocations set total_cost = public.fn_money(quantity * unit_cost)
   where batch_id = p_batch_id;

  perform public.rpc_recompute_sale_cogs(p_batch_id => p_batch_id);

  perform public.fn_audit('PURCHASE_COST_RECORD', 'purchase_batches', p_batch_id,
    jsonb_build_object('unit_cost', case when v_batch.cost_status = 'RECORDED' then v_batch.unit_cost else null end),
    jsonb_build_object('unit_cost', p_unit_cost, 'reason', p_reason));

  return jsonb_build_object('batch_id', p_batch_id, 'unit_cost', public.fn_money(p_unit_cost),
                            'cost_status', 'RECORDED');
end $$;

-- Refresh a sale's COGS from its FIFO allocations (used after a batch cost is
-- recorded, or repaired). Keeps the P&L derived rather than typed.
create or replace function public.rpc_recompute_sale_cogs(p_batch_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_require_owner();

  with touched as (
    select distinct fa.sale_item_id
    from public.fifo_allocations fa
    where p_batch_id is null or fa.batch_id = p_batch_id
  ),
  rolled as (
    select si.id as sale_item_id,
           public.fn_money(sum(case when fa.direction = 'OUT' then fa.total_cost else -fa.total_cost end)) as cogs
    from public.sale_items si
    join public.fifo_allocations fa on fa.sale_item_id = si.id
    where si.id in (select sale_item_id from touched)
    group by si.id
  )
  update public.sale_items si
     set line_cogs = r.cogs,
         unit_cogs = case when si.quantity > 0 then public.fn_money(r.cogs / si.quantity) else 0 end
    from rolled r
   where si.id = r.sale_item_id;

  with sale_cogs as (
    select sa.id,
           public.fn_money(sum(si.line_cogs)) as cogs
    from public.sales sa
    join public.sale_items si on si.sale_id = sa.id
    where p_batch_id is null
       or sa.id in (select distinct fa.sale_id from public.fifo_allocations fa where fa.batch_id = p_batch_id)
    group by sa.id
  )
  update public.sales sa
     set cogs_amount  = sc.cogs,
         gross_profit = public.fn_money(sa.total_amount - sc.cogs)
    from sale_cogs sc
   where sa.id = sc.id;
end $$;

-- ===========================================================================
-- rpc_adjust_stock — physical adjustments, damage, expiry write-offs.
-- Quantity is a DELTA (+ adds, − removes). Owner-only and always audited.
-- ===========================================================================
create or replace function public.rpc_adjust_stock(
  p_product_id    uuid,
  p_quantity      int,
  p_movement_type public.movement_type,
  p_reason        text,
  p_damage_expiry_cost numeric default null,
  p_stock_period_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users;
  v_prod public.products;
  v_movement uuid;
  v_on_hand int;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  if p_movement_type not in ('ADJUSTMENT','DAMAGE','EXPIRED','BEGINNING_STOCK','VOID_REVERSAL') then
    raise exception 'MOVEMENT_NOT_ALLOWED: % cannot be applied through a manual adjustment', p_movement_type
      using errcode = '22023';
  end if;
  if p_quantity = 0 then
    raise exception 'NO_CHANGE: an adjustment of zero has no effect' using errcode = '22023';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: adjustments must record a reason' using errcode = '22023';
  end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND: no product with id %', p_product_id using errcode = '23503';
  end if;

  v_on_hand := public.fn_on_hand(p_product_id);
  if v_on_hand + p_quantity < 0 then
    raise exception 'NEGATIVE_STOCK: % has % units on hand; cannot remove %',
      v_prod.name, v_on_hand, abs(p_quantity) using errcode = '22023';
  end if;

  insert into public.stock_movements (product_id, movement_type, quantity, unit_cost, reference_type,
                                      reason, stock_period_id, created_by)
  values (p_product_id, p_movement_type, p_quantity, p_damage_expiry_cost,
          'adjustment', p_reason, p_stock_period_id, v_user.id)
  returning id into v_movement;

  -- Expiring/expired stock is written off against the batches that hold it so
  -- batch quantities keep matching the ledger.
  if p_quantity < 0 and p_movement_type in ('DAMAGE','EXPIRED') then
    perform public.fn_fifo_consume(p_product_id, null, null, p_quantity, 'OUT');
  end if;

  perform public.fn_audit(
    case p_movement_type when 'DAMAGE' then 'STOCK_DAMAGE'
                         when 'EXPIRED' then 'STOCK_EXPIRED'
                         else 'STOCK_ADJUSTMENT' end,
    'stock_movements', v_movement,
    jsonb_build_object('quantity_on_hand', v_on_hand),
    jsonb_build_object('quantity_change', p_quantity, 'movement_type', p_movement_type,
                       'reason', p_reason, 'product', v_prod.name,
                       'new_quantity_on_hand', v_on_hand + p_quantity));

  return jsonb_build_object('movement_id', v_movement, 'quantity_change', p_quantity,
                            'quantity_on_hand', v_on_hand + p_quantity);
end $$;

-- ===========================================================================
-- Stock periods + biweekly counts (spec §29)
-- ===========================================================================
create or replace function public.rpc_create_stock_period(
  p_period_start date,
  p_period_end   date,
  p_label        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.fn_require_owner();
  if p_period_end < p_period_start then
    raise exception 'INVALID_RANGE: the period end cannot precede the start' using errcode = '22023';
  end if;

  insert into public.stock_periods (label, period_start, period_end)
  values (coalesce(p_label, to_char(p_period_start, 'DD Mon') || ' – ' || to_char(p_period_end, 'DD Mon YYYY')),
          p_period_start, p_period_end)
  returning id into v_id;

  perform public.fn_audit('STOCK_PERIOD_CREATE', 'stock_periods', v_id, null,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end));

  return jsonb_build_object('stock_period_id', v_id);
end $$;

-- Generates the two standard fortnightly periods for a month.
create or replace function public.rpc_generate_month_periods(p_month date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first date := date_trunc('month', p_month)::date;
  v_mid   date := (v_first + interval '14 days')::date;
  v_last  date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_ids   uuid[] := '{}';
  v_id    uuid;
begin
  perform public.fn_require_owner();

  for v_id in
    select public.fn_ensure_stock_period(v_first, v_mid - 1)
    union all
    select public.fn_ensure_stock_period(v_mid, v_last)
  loop
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('month', v_first, 'period_ids', to_jsonb(v_ids));
end $$;

create or replace function public.fn_ensure_stock_period(p_start date, p_end date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.stock_periods where period_start = p_start and period_end = p_end;
  if v_id is null then
    insert into public.stock_periods (label, period_start, period_end)
    values (to_char(p_start, 'DD Mon') || ' – ' || to_char(p_end, 'DD Mon YYYY'), p_start, p_end)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Opens a count sheet: snapshots the expected quantity for every product the
-- caller can see, so the sheet is a real comparison rather than a fresh guess.
create or replace function public.rpc_open_stock_count(
  p_stock_period_id uuid,
  p_category_id     uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
  v_period public.stock_periods;
begin
  perform public.fn_require_internal();

  select * into v_period from public.stock_periods where id = p_stock_period_id;
  if not found then
    raise exception 'PERIOD_NOT_FOUND: no stock period with id %', p_stock_period_id using errcode = '23503';
  end if;
  if v_period.status = 'CLOSED' then
    raise exception 'PERIOD_CLOSED: this stock period is already closed' using errcode = '42501';
  end if;

  insert into public.stock_counts (stock_period_id, product_id, expected_quantity, counted_quantity, counted_by)
  select p_stock_period_id, p.id, public.fn_on_hand(p.id), public.fn_on_hand(p.id), auth.uid()
  from public.products p
  where p.active
    and (p_category_id is null or p.category_id = p_category_id)
  on conflict (stock_period_id, product_id) do nothing;

  get diagnostics v_count = row_count;

  perform public.fn_audit('STOCK_COUNT_OPEN', 'stock_periods', p_stock_period_id, null,
    jsonb_build_object('lines_created', v_count));

  return jsonb_build_object('stock_period_id', p_stock_period_id, 'lines_created', v_count);
end $$;

-- Staff or owner enters physical counts. Quantities only — no cost fields.
create or replace function public.rpc_submit_stock_count(
  p_stock_period_id uuid,
  p_lines jsonb              -- [{"product_id":"…","counted_quantity":12}, …]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users;
  v_line record;
  v_updated int := 0;
  v_missing uuid[] := '{}';
  v_prod uuid;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_internal();

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'NO_LINES: provide at least one counted product' using errcode = '22023';
  end if;

  for v_prod in
    select (e ->> 'product_id')::uuid from jsonb_array_elements(p_lines) e order by 1
  loop
    perform 1 from public.products where id = v_prod for update;
  end loop;

  for v_line in
    select (e ->> 'product_id')::uuid as product_id, (e ->> 'counted_quantity')::int as counted_quantity
    from jsonb_array_elements(p_lines) e
  loop
    if v_line.counted_quantity < 0 then
      raise exception 'INVALID_COUNT: counted quantities cannot be negative' using errcode = '22023';
    end if;

    -- Expected is re-read at submit time (not trusted from the sheet) so that
    -- a sale made during the count is picked up rather than silently absorbed.
    update public.stock_counts sc
       set counted_quantity = v_line.counted_quantity,
           expected_quantity = public.fn_on_hand(v_line.product_id),
           counted_by = v_user.id,
           status = 'PENDING'
     where sc.stock_period_id = p_stock_period_id and sc.product_id = v_line.product_id;

    if not found then
      insert into public.stock_counts (stock_period_id, product_id, expected_quantity, counted_quantity, counted_by)
      values (p_stock_period_id, v_line.product_id, public.fn_on_hand(v_line.product_id),
              v_line.counted_quantity, v_user.id);
    end if;
    v_updated := v_updated + 1;
  end loop;

  perform public.fn_audit('STOCK_COUNT_SUBMIT', 'stock_periods', p_stock_period_id, null,
    jsonb_build_object('lines', v_updated, 'submitted_by', v_user.full_name));

  return jsonb_build_object('stock_period_id', p_stock_period_id, 'lines_updated', v_updated);
end $$;

-- Owner confirms: variances become ADJUSTMENT movements, and the period closes
-- with its physical totals. Owner-only because it touches valuation.
create or replace function public.rpc_confirm_stock_count(
  p_stock_period_id uuid,
  p_confirm         boolean default true,
  p_notes           text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users;
  v_line record;
  v_adjusted int := 0;
  v_variance_units int := 0;
  v_variance_value numeric := 0;
  v_cost numeric;
  v_period public.stock_periods;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  select * into v_period from public.stock_periods where id = p_stock_period_id for update;
  if not found then
    raise exception 'PERIOD_NOT_FOUND: no stock period with id %', p_stock_period_id using errcode = '23503';
  end if;

  if not p_confirm then
    update public.stock_counts set status = 'PENDING', notes = coalesce(p_notes, notes)
     where stock_period_id = p_stock_period_id and status = 'CONFIRMED';
    perform public.fn_audit('STOCK_COUNT_REOPEN', 'stock_periods', p_stock_period_id, null, null);
    return jsonb_build_object('stock_period_id', p_stock_period_id, 'confirmed', false);
  end if;

  for v_line in
    select * from public.stock_counts
    where stock_period_id = p_stock_period_id and status = 'PENDING' and variance <> 0
    order by product_id
  loop
    v_cost := public.fn_avg_unit_cost(v_line.product_id);

    perform 1 from public.products where id = v_line.product_id for update;

    insert into public.stock_movements (product_id, movement_type, quantity, unit_cost, reference_type,
                                        stock_period_id, reason, created_by)
    values (v_line.product_id, 'ADJUSTMENT', v_line.variance, v_cost, 'stock_count',
            p_stock_period_id,
            'Biweekly count variance for ' || v_period.label, v_user.id);

    -- Keep FIFO batches consistent with a negative variance (missing stock is
    -- removed from the oldest batches, the same order it would have sold in).
    if v_line.variance < 0 then
      perform public.fn_fifo_consume(v_line.product_id, null, null, v_line.variance, 'OUT');
    end if;

    update public.stock_counts
       set unit_cost = v_cost,
           variance_value = public.fn_money(v_line.variance * v_cost),
           status = 'CONFIRMED',
           confirmed_by = v_user.id,
           confirmed_at = now(),
           notes = coalesce(p_notes, notes)
     where id = v_line.id;

    v_adjusted := v_adjusted + 1;
    v_variance_units := v_variance_units + abs(v_line.variance);
    v_variance_value := v_variance_value + public.fn_money(v_line.variance * v_cost);
  end loop;

  update public.stock_counts set status = 'CONFIRMED', confirmed_by = v_user.id, confirmed_at = now()
   where stock_period_id = p_stock_period_id and status = 'PENDING';

  update public.stock_periods
     set status = 'CLOSED', closed_at = now(), closed_by = v_user.id, notes = coalesce(p_notes, notes)
   where id = p_stock_period_id;

  -- The next period's opening balance is the running ledger, which the
  -- ADJUSTMENT rows above have just reconciled to the physical count. Writing a
  -- second BEGINNING_STOCK row here would double-count the stock, so we record
  -- the carry-forward as a period note instead and open the next sheet with it.
  update public.stock_periods
     set notes = concat_ws(E'\n', notes,
           format('Opening balance for the next period is the physical count confirmed on %s (see this period''s count sheet).',
                  to_char(now(), 'DD Mon YYYY')))
   where id = public.fn_ensure_stock_period(
           v_period.period_end + 1,
           (date_trunc('month', v_period.period_end) + interval '1 month - 1 day')::date);

  perform public.fn_audit('STOCK_COUNT_CONFIRM', 'stock_periods', p_stock_period_id,
    jsonb_build_object('status', v_period.status),
    jsonb_build_object('status', 'CLOSED', 'adjusted_lines', v_adjusted,
                       'variance_units', v_variance_units, 'variance_value', v_variance_value,
                       'notes', p_notes));

  return jsonb_build_object('stock_period_id', p_stock_period_id, 'confirmed', true,
                            'adjusted_lines', v_adjusted, 'variance_units', v_variance_units,
                            'variance_value', public.fn_money(v_variance_value));
end $$;
