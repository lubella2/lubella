-- ============================================================================
-- LuBella  |  Migration 0011 — POS: sale, return, void
-- ============================================================================
-- These three functions are the only writers of revenue, COGS, FIFO history,
-- supplier payables and commission. Each one is a single database transaction:
-- if any step raises, PostgreSQL rolls back every preceding step, so a partial
-- financial transaction is impossible (spec §33, §63).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: allocate a whole-sale discount across lines so that the parts sum
-- exactly to the discount. Rounds each line half-up, then gives the final line
-- the remainder — no cent is ever created or lost by rounding.
-- ---------------------------------------------------------------------------
create or replace function public.fn_allocate_discount(
  p_subtotals numeric[],   -- line subtotals, in line order
  p_discount  numeric
) returns numeric[]
language plpgsql
immutable
as $$
declare
  v_total    numeric := coalesce((select sum(x) from unnest(p_subtotals) x), 0);
  v_result   numeric[] := array[]::numeric[];
  v_running  numeric := 0;
  v_share    numeric;
  v_i        int;
  v_n        int := coalesce(array_length(p_subtotals, 1), 0);
begin
  if v_n = 0 then return v_result; end if;
  if p_discount = 0 or v_total = 0 then
    return array_fill(0::numeric, array[v_n]);
  end if;

  for v_i in 1 .. v_n loop
    if v_i = v_n then
      v_share := public.fn_money(p_discount - v_running);
    else
      v_share := public.fn_money(round(p_discount * p_subtotals[v_i] / v_total, 2));
    end if;
    v_running := v_running + v_share;
    v_result := v_result || v_share;
  end loop;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Generic FIFO consumer.
--
-- Walks the product's open batches oldest-first, takes what it can from each,
-- writes an append-only fifo_allocations row, and decrements the batch. Returns
-- the total cost consumed. Used by SALE (needed = +qty) and by RETURN/VOID
-- reversal (needed = -qty, which walks batches newest-first to be the exact
-- inverse of FIFO).
--
-- Caller MUST already hold a row lock on the product (SELECT ... FOR UPDATE).
-- ---------------------------------------------------------------------------
create or replace function public.fn_fifo_consume(
  p_product_id uuid,
  p_sale_id    uuid,
  p_sale_item_id uuid,
  p_quantity   int,             -- positive = consume (sale), negative = restore
  p_direction  text default 'OUT'
) returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_needed   int := abs(p_quantity);
  v_take     int;
  v_cost     numeric := 0;
  v_batch    record;
begin
  if v_needed = 0 then return 0; end if;

  if p_direction = 'OUT' then
    -- FORWARD FIFO: first received, first sold.
    for v_batch in
      select b.id, b.unit_cost, b.quantity_remaining
      from public.purchase_batches b
      where b.product_id = p_product_id and b.quantity_remaining > 0
      order by b.received_date asc, b.created_at asc, b.id asc
      for update
    loop
      exit when v_needed <= 0;
      v_take := least(v_needed, v_batch.quantity_remaining);

      insert into public.fifo_allocations
        (batch_id, product_id, supplier_id, sale_id, sale_item_id, quantity, unit_cost, total_cost, direction)
      select v_batch.id, p_product_id, b2.supplier_id, p_sale_id, p_sale_item_id,
             v_take, v_batch.unit_cost, public.fn_money(v_take * v_batch.unit_cost), 'OUT'
      from public.purchase_batches b2 where b2.id = v_batch.id;

      update public.purchase_batches
         set quantity_remaining = quantity_remaining - v_take,
             quantity_sold      = quantity_sold + v_take,
             status             = case when quantity_remaining - v_take <= 0 then 'DEPLETED'::public.batch_status
                                       else 'OPEN'::public.batch_status end
       where id = v_batch.id;

      v_cost   := v_cost + public.fn_money(v_take * v_batch.unit_cost);
      v_needed := v_needed - v_take;
    end loop;
  else
    -- INVERSE of FIFO: restore to the newest batches first.
    for v_batch in
      select b.id, b.unit_cost, b.quantity_received, b.quantity_remaining
      from public.purchase_batches b
      where b.product_id = p_product_id
      order by b.received_date desc, b.created_at desc, b.id desc
      for update
    loop
      exit when v_needed <= 0;
      -- never restore more than this batch actually sold
      v_take := least(v_needed, v_batch.quantity_received - v_batch.quantity_remaining);
      continue when v_take <= 0;

      insert into public.fifo_allocations
        (batch_id, product_id, supplier_id, sale_id, sale_item_id, quantity, unit_cost, total_cost, direction)
      select v_batch.id, p_product_id, b2.supplier_id, p_sale_id, p_sale_item_id,
             v_take, v_batch.unit_cost, public.fn_money(-1 * v_take * v_batch.unit_cost), 'IN'
      from public.purchase_batches b2 where b2.id = v_batch.id;

      update public.purchase_batches
         set quantity_remaining = quantity_remaining + v_take,
             quantity_sold      = quantity_sold - v_take,
             status             = 'OPEN'::public.batch_status
       where id = v_batch.id;

      v_cost   := v_cost + public.fn_money(v_take * v_batch.unit_cost);
      v_needed := v_needed - v_take;
    end loop;
  end if;

  if v_needed > 0 then
    raise exception 'FIFO_MISMATCH: could not account for % unit(s) of product % (batch records do not cover the movement)',
      v_needed, p_product_id using errcode = '23514';
  end if;

  return public.fn_money(v_cost);
end $$;

-- ===========================================================================
-- rpc_complete_sale — spec §32, §33, §34, §35
-- ===========================================================================
create or replace function public.rpc_complete_sale(
  p_items            jsonb,                      -- [{"product_id":"…","quantity":2}, …]
  p_payment_method   public.payment_method,
  p_discount_amount  numeric default 0,
  p_client_ref       text    default null,
  p_amount_tendered  numeric default null,
  p_payment_reference text   default null,
  p_notes            text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user        public.app_users;
  v_existing    public.sales;
  v_sale_id     uuid;
  v_sale_number text;
  v_subtotal    numeric := 0;
  v_discount    numeric := public.fn_money(coalesce(p_discount_amount, 0));
  v_total       numeric := 0;
  v_cogs        numeric := 0;
  v_line_cogs   numeric;
  v_rate        numeric;
  v_commission  numeric;
  v_change      numeric := null;
  v_line        record;
  v_prod        public.products;
  v_on_hand     int;
  v_no          int := 0;
  v_subtotals   numeric[] := array[]::numeric[];
  v_discounts   numeric[];
  v_lines       jsonb := '[]'::jsonb;
  v_req         jsonb;
begin
  v_user := public.fn_current_user_row();
  if v_user.id is null or v_user.role not in ('OWNER','STAFF') or not v_user.active then
    raise exception 'INTERNAL_ONLY: only LuBella staff may complete a sale' using errcode = '42501';
  end if;

  perform public.fn_require_open_period(current_date);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART: a sale must contain at least one product' using errcode = '22023';
  end if;

  -- Idempotency: a retried request returns the original sale, never a duplicate.
  if p_client_ref is not null then
    select * into v_existing from public.sales where client_ref = p_client_ref;
    if found then
      return jsonb_build_object(
        'sale_id', v_existing.id, 'sale_number', v_existing.sale_number,
        'total_amount', v_existing.total_amount, 'subtotal', v_existing.subtotal,
        'discount_amount', v_existing.discount_amount,
        'payment_method', v_existing.payment_method,
        'status', v_existing.status, 'replayed', true
      );
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- 1. Lock every product in the cart, in a deterministic order, so that two
  --    concurrent tills touching the same products serialise here instead of
  --    overselling. Stock is then re-read *after* the lock is held.
  -- ---------------------------------------------------------------------
  -- Duplicate cart lines for the same product are merged, and the resulting
  -- set is ordered by product id. Every later pass re-derives the identical
  -- set in the identical order, so line indexes stay aligned.
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    group by (e ->> 'product_id')
    having sum((e ->> 'quantity')::int)::int <= 0
  ) then
    raise exception 'INVALID_QUANTITY: quantities must be greater than zero' using errcode = '22023';
  end if;

  for v_line in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::int)::int as quantity
    from jsonb_array_elements(p_items) e
    group by 1 order by 1
  loop
    select * into v_prod from public.products where id = v_line.product_id for update;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND: product % does not exist', v_line.product_id using errcode = '23503';
    end if;
    if not v_prod.active then
      raise exception 'PRODUCT_INACTIVE: % is no longer sold', v_prod.name using errcode = '22023';
    end if;
    if v_prod.expiry_date is not null and v_prod.expiry_date < current_date then
      raise exception 'PRODUCT_EXPIRED: % expired on % and cannot be sold',
        v_prod.name, to_char(v_prod.expiry_date, 'DD Mon YYYY') using errcode = '22023';
    end if;

    v_on_hand := public.fn_on_hand(v_prod.id);
    if v_on_hand < v_line.quantity then
      -- Structured payload the POS turns into the exact spec §32 prompt:
      -- «Only X units are currently available…» with Continue with X / Cancel.
      raise exception 'INSUFFICIENT_STOCK|%',
        jsonb_build_object(
          'product_id', v_prod.id,
          'product_name', v_prod.name,
          'requested', v_line.quantity,
          'available', greatest(v_on_hand, 0)
        )::text
        using errcode = 'P0001',
              hint = jsonb_build_object(
                'product_id', v_prod.id, 'product_name', v_prod.name,
                'requested', v_line.quantity, 'available', greatest(v_on_hand, 0)
              )::text;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- 2. Build the priced lines and allocate the discount across them.
  -- ---------------------------------------------------------------------
  for v_line in
    select c.product_id, c.quantity, p.name, p.selling_price
    from (
      select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::int)::int as quantity
      from jsonb_array_elements(p_items) e group by 1
    ) c
    join public.products p on p.id = c.product_id
    order by c.product_id
  loop
    v_subtotals := v_subtotals || public.fn_money(v_line.quantity * v_line.selling_price);
  end loop;

  v_subtotal := public.fn_money(coalesce((select sum(x) from unnest(v_subtotals) x), 0));

  if v_discount < 0 then
    raise exception 'DISCOUNT_INVALID: discount cannot be negative' using errcode = '22023';
  end if;
  if v_discount > v_subtotal then
    raise exception 'DISCOUNT_INVALID: discount (%) exceeds the subtotal (%)',
      v_discount, v_subtotal using errcode = '22023';
  end if;

  v_discounts := public.fn_allocate_discount(v_subtotals, v_discount);
  v_total := public.fn_money(v_subtotal - v_discount);

  v_sale_number := public.fn_next_number('S', 6);

  insert into public.sales (
    sale_number, sale_date, subtotal, discount_amount, discount_percent, total_amount,
    payment_method, payment_reference, amount_tendered, change_given, staff_id, notes, client_ref
  ) values (
    v_sale_number, current_date, v_subtotal, v_discount,
    case when v_subtotal > 0 then round(v_discount / v_subtotal * 100, 2) else 0 end,
    v_total, p_payment_method, p_payment_reference,
    p_amount_tendered,
    case when p_amount_tendered is not null then public.fn_money(p_amount_tendered - v_total) end,
    v_user.id, p_notes, p_client_ref
  ) returning id into v_sale_id;

  if p_payment_method = 'CASH' and p_amount_tendered is not null then
    if p_amount_tendered < v_total then
      raise exception 'INSUFFICIENT_PAYMENT: tendered % is less than the total %',
        p_amount_tendered, v_total using errcode = '22023';
    end if;
    v_change := public.fn_money(p_amount_tendered - v_total);
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Per line: sale item, FIFO consumption, COGS, stock movement, payable.
  -- ---------------------------------------------------------------------
  v_no := 0;
  for v_line in
    select c.product_id, c.quantity, p.name, p.selling_price, p.supplier_id
    from (
      select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::int)::int as quantity
      from jsonb_array_elements(p_items) e group by 1
    ) c
    join public.products p on p.id = c.product_id
    order by c.product_id
  loop
    v_no := v_no + 1;
    declare
      v_line_subtotal numeric := v_subtotals[v_no];
      v_line_discount numeric := v_discounts[v_no];
      v_line_total    numeric := public.fn_money(v_subtotals[v_no] - v_discounts[v_no]);
      v_item_id       uuid;
      v_consumed      numeric;
    begin
      insert into public.sale_items (
        sale_id, product_id, quantity, unit_price, line_subtotal, line_discount, line_total
      ) values (
        v_sale_id, v_line.product_id, v_line.quantity, v_line.selling_price,
        v_line_subtotal, v_line_discount, v_line_total
      ) returning id into v_item_id;

      -- FIFO: consumes the oldest batches and records exactly which batch (and
      -- therefore which supplier, at which cost) every sold unit came from.
      v_consumed := public.fn_fifo_consume(v_line.product_id, v_sale_id, v_item_id, v_line.quantity, 'OUT');
      v_cogs := v_cogs + v_consumed;

      update public.sale_items
         set line_cogs = v_consumed,
             unit_cogs = case when v_line.quantity > 0
                              then public.fn_money(v_consumed / v_line.quantity) else 0 end
       where id = v_item_id;

      -- Supplier payable arises from the COST of the units actually sold, per
      -- batch. Unsold stock is not payable (spec §22).
      insert into public.supplier_payables (
        supplier_id, product_id, purchase_batch_id, fifo_allocation_id, sale_id,
        entry_date, quantity_sold, purchase_cost, payable_amount, amount_paid, outstanding
      )
      select fa.supplier_id, fa.product_id, fa.batch_id, fa.id, v_sale_id,
             current_date, fa.quantity, fa.unit_cost, fa.total_cost, 0, fa.total_cost
      from public.fifo_allocations fa
      where fa.sale_item_id = v_item_id and fa.direction = 'OUT';

      insert into public.stock_movements (
        product_id, movement_type, quantity, reference_type, reference_id, reason, created_by
      ) values (
        v_line.product_id, 'SALE', -1 * v_line.quantity, 'sale', v_sale_id,
        'Sale ' || v_sale_number, v_user.id
      );

      v_lines := v_lines || jsonb_build_object(
        'product_id', v_line.product_id, 'product_name', v_line.name,
        'quantity', v_line.quantity, 'unit_price', v_line.selling_price,
        'line_subtotal', v_line_subtotal, 'line_discount', v_line_discount,
        'line_total', v_line_total
      );
    end;
  end loop;

  -- ---------------------------------------------------------------------
  -- 4. COGS, gross profit, commission (on the POST-discount amount).
  -- ---------------------------------------------------------------------
  v_cogs := public.fn_money(v_cogs);

  update public.sales
     set cogs_amount = v_cogs,
         gross_profit = public.fn_money(v_total - v_cogs)
   where id = v_sale_id;

  v_rate := coalesce(v_user.commission_rate, 0);
  v_commission := public.fn_money(v_total * v_rate);

  insert into public.commissions (staff_id, sale_id, amount, rate, type, sale_date, created_by)
  values (v_user.id, v_sale_id, v_commission, v_rate, 'EARNED', current_date, v_user.id);

  perform public.fn_audit('SALE_CREATE', 'sales', v_sale_id, null,
    jsonb_build_object(
      'sale_number', v_sale_number, 'subtotal', v_subtotal, 'discount', v_discount,
      'total', v_total, 'cogs', v_cogs, 'commission', v_commission,
      'payment_method', p_payment_method, 'items', v_lines
    ));

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'sale_date', current_date,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'total_amount', v_total,
    'amount_tendered', p_amount_tendered,
    'change_given', v_change,
    'payment_method', p_payment_method,
    'staff_name', v_user.full_name,
    'commission', v_commission,
    'items', v_lines,
    'replayed', false
  );
end $$;

-- ===========================================================================
-- rpc_process_return — spec §37. Owner-only, full or partial.
-- ===========================================================================
create or replace function public.rpc_process_return(
  p_sale_id uuid,
  p_items   jsonb,                 -- [{"sale_item_id":"…","quantity":1}, …]
  p_reason  text default null,
  p_restock boolean default true   -- true = goods go back on the shelf
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user        public.app_users;
  v_sale        public.sales;
  v_return_id   uuid;
  v_return_no   text;
  v_line        record;
  v_item        public.sale_items;
  v_staff_rate  numeric;
  v_refund      numeric := 0;
  v_cogs_rev    numeric := 0;
  v_remaining_value numeric;
  v_line_refund numeric;
  v_line_cogs   numeric;
  v_comm_rev    numeric := 0;
  v_remaining   int;
  v_all_returned boolean;
  v_rows        jsonb := '[]'::jsonb;
  v_type        public.return_type;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND: no sale with id %', p_sale_id using errcode = '23503';
  end if;
  if v_sale.status = 'VOIDED' then
    raise exception 'SALE_VOIDED: sale % was voided; returns cannot be applied to it', v_sale.sale_number
      using errcode = '22023';
  end if;

  perform public.fn_require_open_period(v_sale.sale_date);

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_RETURN_ITEMS: select at least one line to return' using errcode = '22023';
  end if;

  v_return_no := public.fn_next_number('RET', 6);
  v_type := case when (
      select bool_and(si.returned_qty + (e ->> 'quantity')::int = si.quantity)
      from jsonb_array_elements(p_items) e
      join public.sale_items si on si.id = (e ->> 'sale_item_id')::uuid
    ) then 'FULL'::public.return_type else 'PARTIAL'::public.return_type end;

  insert into public.returns (return_number, sale_id, return_date, return_type, return_amount,
                              restock_decision, reason, processed_by)
  values (v_return_no, p_sale_id, current_date, v_type, 1,   -- placeholder, corrected below
          case when p_restock then 'RESTOCK' else 'DAMAGE' end, p_reason, v_user.id)
  returning id into v_return_id;

  for v_line in
    select (e ->> 'sale_item_id')::uuid as sale_item_id, (e ->> 'quantity')::int as quantity
    from jsonb_array_elements(p_items) e
  loop
    if v_line.quantity <= 0 then
      raise exception 'INVALID_QUANTITY: return quantities must be greater than zero' using errcode = '22023';
    end if;

    select * into v_item from public.sale_items
     where id = v_line.sale_item_id and sale_id = p_sale_id for update;
    if not found then
      raise exception 'ITEM_NOT_IN_SALE: sale item % does not belong to sale %',
        v_line.sale_item_id, v_sale.sale_number using errcode = '22023';
    end if;
    if v_item.returned_qty + v_line.quantity > v_item.quantity then
      raise exception 'OVER_RETURN: % already returned %, only % more can be returned',
        (select name from public.products where id = v_item.product_id),
        v_item.returned_qty, v_item.quantity - v_item.returned_qty using errcode = '22023';
    end if;

    -- Refund is based on what the customer actually paid for that line
    -- (post-discount), computed against the REMAINING value rather than a
    -- per-unit figure. Returning the last unit on a line refunds the remaining
    -- value in full, so rounding can never push refunds past what was charged
    -- (e.g. a 1,690.91 line refunded as 2 x 845.46 would over-refund by a cent).
    v_remaining_value := public.fn_money(v_item.line_total - v_item.refunded_amount);
    if v_line.quantity = (v_item.quantity - v_item.returned_qty) then
      v_line_refund := v_remaining_value;
    else
      v_line_refund := public.fn_money(v_remaining_value * v_line.quantity
                                       / (v_item.quantity - v_item.returned_qty));
    end if;
    v_line_cogs   := 0;

    if p_restock then
      -- restock the units and reverse the FIFO/COGS/payable effect
      begin
        perform 1 from public.products where id = v_item.product_id for update;

        v_line_cogs := public.fn_fifo_consume(v_item.product_id, p_sale_id, v_item.id,
                                             -1 * v_line.quantity, 'IN');

        -- Reverse the supplier payable that was recognised for these units.
        insert into public.supplier_payables (
          supplier_id, product_id, purchase_batch_id, sale_id, entry_date,
          quantity_sold, purchase_cost, payable_amount, amount_paid, outstanding, is_reversal
        )
        select fa.supplier_id, fa.product_id, fa.batch_id, p_sale_id, current_date,
               -1 * fa.quantity, fa.unit_cost, public.fn_money(-1 * fa.total_cost), 0,
               public.fn_money(-1 * fa.total_cost), true
        from public.fifo_allocations fa
        where fa.sale_item_id = v_item.id and fa.direction = 'IN'
          and fa.created_at = (select max(created_at) from public.fifo_allocations f2
                                where f2.sale_item_id = v_item.id and f2.direction = 'IN');

        insert into public.stock_movements (product_id, movement_type, quantity, unit_cost,
                                           reference_type, reference_id, reason, created_by)
        values (v_item.product_id, 'RETURN', v_line.quantity, null, 'return', v_return_id,
                'Return ' || v_return_no || coalesce(' — ' || p_reason, ''), v_user.id);
      end;
    else
      -- DAMAGE: the money is refunded but the goods are not resalable, so the
      -- cost stays recognised in COGS as a write-off and the supplier is still
      -- payable for the unit. Deliberate, documented rule (docs/05-BUSINESS-RULES.md).
      null;
    end if;

    insert into public.return_items (return_id, sale_item_id, product_id, quantity, unit_price,
                                     refund_amount, unit_cogs, cogs_reversed)
    values (v_return_id, v_item.id, v_item.product_id, v_line.quantity, v_item.unit_price,
            v_line_refund, v_item.unit_cogs, v_line_cogs);

    update public.sale_items
       set returned_qty      = returned_qty + v_line.quantity,
           refunded_amount   = public.fn_money(refunded_amount + v_line_refund)
     where id = v_item.id;

    v_refund    := v_refund + v_line_refund;
    v_cogs_rev  := v_cogs_rev + v_line_cogs;

    -- Commission is reversed on the POST-discount refunded value.
    select coalesce(rate, 0) into v_staff_rate from public.commissions
     where sale_id = p_sale_id and type = 'EARNED' limit 1;
    v_staff_rate := coalesce(v_staff_rate, 0);
    if v_staff_rate > 0 then
      insert into public.commissions (staff_id, sale_id, return_id, amount, rate, type, sale_date, note, created_by)
      values (v_sale.staff_id, p_sale_id, v_return_id,
              public.fn_money(-1 * v_line_refund * v_staff_rate), v_staff_rate,
              'RETURN_REVERSAL', current_date, 'Reversal for ' || v_return_no, v_user.id);
      v_comm_rev := v_comm_rev + public.fn_money(v_line_refund * v_staff_rate);
    end if;

    v_rows := v_rows || jsonb_build_object(
      'sale_item_id', v_item.id, 'product_id', v_item.product_id,
      'product_name', (select name from public.products where id = v_item.product_id),
      'quantity', v_line.quantity, 'refund_amount', v_line_refund,
      'cogs_reversed', v_line_cogs
    );
  end loop;

  -- finalise the return header with its real totals
  update public.returns
     set return_amount = public.fn_money(v_refund),
         cogs_reversed = public.fn_money(v_cogs_rev)
   where id = v_return_id;

  select bool_and(si.returned_qty = si.quantity) into v_all_returned
  from public.sale_items si where si.sale_id = p_sale_id;

  update public.sales
     set returned_amount = public.fn_money(returned_amount + v_refund),
         status = case when v_all_returned then 'RETURNED'::public.sale_status
                       else 'PARTIALLY_RETURNED'::public.sale_status end
   where id = p_sale_id;

  perform public.fn_audit('RETURN_PROCESS', 'returns', v_return_id,
    jsonb_build_object('sale_number', v_sale.sale_number, 'sale_total', v_sale.total_amount,
                       'returned_before', v_sale.returned_amount),
    jsonb_build_object('return_number', v_return_no, 'refund_amount', v_refund,
                       'cogs_reversed', v_cogs_rev, 'commission_reversed', v_comm_rev,
                       'restock', p_restock, 'items', v_rows, 'reason', p_reason));

  return jsonb_build_object(
    'return_id', v_return_id, 'return_number', v_return_no, 'return_type', v_type,
    'refund_amount', public.fn_money(v_refund), 'cogs_reversed', public.fn_money(v_cogs_rev),
    'commission_reversed', public.fn_money(v_comm_rev),
    'restocked', p_restock, 'items', v_rows,
    'sale_number', v_sale.sale_number,
    'sale_status', (select status from public.sales where id = p_sale_id)
  );
end $$;

-- ===========================================================================
-- rpc_void_sale — spec §38. A completed sale is never deleted; a void is a
-- reversal of what has not already been returned. The original row survives.
-- ===========================================================================
create or replace function public.rpc_void_sale(
  p_sale_id uuid,
  p_reason  text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      public.app_users;
  v_sale      public.sales;
  v_item      record;
  v_rate      numeric := 0;
  v_remaining int;
  v_amount    numeric := 0;
  v_cogs_rev  numeric := 0;
  v_comm_rev  numeric := 0;
  v_line_amt  numeric;
  v_line_cogs numeric;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: a void must record a reason' using errcode = '22023';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND: no sale with id %', p_sale_id using errcode = '23503';
  end if;
  if v_sale.status = 'VOIDED' then
    raise exception 'ALREADY_VOIDED: sale % is already voided', v_sale.sale_number using errcode = '22023';
  end if;

  perform public.fn_require_open_period(v_sale.sale_date);

  select coalesce(rate, 0) into v_rate from public.commissions
   where sale_id = p_sale_id and type = 'EARNED' limit 1;
  v_rate := coalesce(v_rate, 0);

  for v_item in
    select * from public.sale_items where sale_id = p_sale_id order by id
  loop
    v_remaining := v_item.quantity - v_item.returned_qty;
    continue when v_remaining <= 0;

    perform 1 from public.products where id = v_item.product_id for update;

    -- A void gives back exactly what was charged and not already refunded, so
    -- a partially-returned sale voids without over- or under-refunding.
    v_line_amt := public.fn_money(v_item.line_total - v_item.refunded_amount);

    v_line_cogs := public.fn_fifo_consume(v_item.product_id, p_sale_id, v_item.id,
                                          -1 * v_remaining, 'IN');

    insert into public.supplier_payables (
      supplier_id, product_id, purchase_batch_id, sale_id, entry_date,
      quantity_sold, purchase_cost, payable_amount, amount_paid, outstanding, is_reversal
    )
    select fa.supplier_id, fa.product_id, fa.batch_id, p_sale_id, current_date,
           -1 * fa.quantity, fa.unit_cost, public.fn_money(-1 * fa.total_cost), 0,
           public.fn_money(-1 * fa.total_cost), true
    from public.fifo_allocations fa
    where fa.sale_item_id = v_item.id and fa.direction = 'IN'
      and fa.created_at = (select max(created_at) from public.fifo_allocations f2
                            where f2.sale_item_id = v_item.id and f2.direction = 'IN');

    insert into public.stock_movements (product_id, movement_type, quantity, reference_type,
                                        reference_id, reason, created_by)
    values (v_item.product_id, 'VOID_REVERSAL', v_remaining, 'sale', p_sale_id,
            'Void of ' || v_sale.sale_number || ' — ' || p_reason, v_user.id);

    if v_rate > 0 then
      insert into public.commissions (staff_id, sale_id, amount, rate, type, sale_date, note, created_by)
      values (v_sale.staff_id, p_sale_id, public.fn_money(-1 * v_line_amt * v_rate), v_rate,
              'VOID_REVERSAL', current_date, 'Void reversal for ' || v_sale.sale_number, v_user.id);
      v_comm_rev := v_comm_rev + public.fn_money(v_line_amt * v_rate);
    end if;

    update public.sale_items
       set refunded_amount = public.fn_money(refunded_amount + v_line_amt)
     where id = v_item.id;

    v_amount   := v_amount + v_line_amt;
    v_cogs_rev := v_cogs_rev + v_line_cogs;
  end loop;

  update public.sales
     set status = 'VOIDED',
         voided_at = now(),
         voided_by = v_user.id,
         void_reason = p_reason,
         -- revenue that has been given back to the customer through this void
         returned_amount = public.fn_money(returned_amount + v_amount)
   where id = p_sale_id;

  perform public.fn_audit('VOID_SALE', 'sales', p_sale_id,
    jsonb_build_object('status', v_sale.status, 'total_amount', v_sale.total_amount,
                       'cogs_amount', v_sale.cogs_amount, 'returned_amount', v_sale.returned_amount),
    jsonb_build_object('status', 'VOIDED', 'voided_amount', public.fn_money(v_amount),
                       'cogs_reversed', public.fn_money(v_cogs_rev),
                       'commission_reversed', public.fn_money(v_comm_rev), 'reason', p_reason));

  return jsonb_build_object(
    'sale_id', p_sale_id, 'sale_number', v_sale.sale_number, 'status', 'VOIDED',
    'voided_amount', public.fn_money(v_amount), 'cogs_reversed', public.fn_money(v_cogs_rev),
    'commission_reversed', public.fn_money(v_comm_rev), 'reason', p_reason
  );
end $$;
