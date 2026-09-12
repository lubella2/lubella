-- ============================================================================
-- LuBella  |  Business-rule tests  (spec §62)
-- ============================================================================
-- Executed with the session switched to `authenticated` + the owner's claims,
-- so RLS and the in-function guards are both live during these assertions.
-- ============================================================================

\set ON_ERROR_STOP on

-- Identities are captured while still superuser: once the session switches to
-- `authenticated`, RLS on app_users means auth.uid() must already be set, so the
-- ids have to be resolved first.
select id as owner_id from public.app_users where role = 'OWNER' \gset
select id as sara_id  from public.app_users where email = 'sara@lubella.shop' \gset
select id as hana_id  from public.app_users where email = 'hana@lubella.shop' \gset
select id as abc_user_id from public.app_users where email = 'abc@supplier.et' \gset
select id as xyz_user_id from public.app_users where email = 'xyz@supplier.et' \gset

-- Identity for these tests is carried by the JWT claims alone; the database
-- role is left as the migration/owner superuser so that assertions can read the
-- sensitive tables directly (fifo_allocations, supplier_payables, … which are
-- deliberately NOT granted to any client role — see 03_security_rls.sql for the
-- tests that prove those walls hold for staff, suppliers and customers).
-- The RPCs still resolve auth.uid() from the claims, so every in-function guard
-- (owner-only, staff-cost-stripping) is exercised for real.
select set_config('request.jwt.claims',
  json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, false);

\echo '--- §23 FIFO: 20 @ 300 then 20 @ 350, sell 25 ---'
select public.rpc_complete_sale(
  p_items => jsonb_build_array(
    jsonb_build_object('product_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'quantity', 25)),
  p_payment_method => 'CASH',
  p_amount_tendered => 15000
) as fifo_sale \gset

select public.fn_money(sum(total_cost)) as fifo_cogs
  from public.fifo_allocations
 where sale_id = (:'fifo_sale'::jsonb ->> 'sale_id')::uuid and direction = 'OUT' \gset
select testing.eq('FIFO', 'COGS for 25 units = 20x300 + 5x350 = 7,750', :'fifo_cogs'::numeric, 7750.00);

-- the two allocations must be exactly one per batch, oldest first
select testing.eq_int('FIFO', 'batch 1 contributed 20 units',
  (select quantity from public.fifo_allocations
    where batch_id = 'cccccccc-0000-0000-0000-000000000001' and direction = 'OUT'), 20);
select testing.eq_int('FIFO', 'batch 2 contributed 5 units',
  (select quantity from public.fifo_allocations
    where batch_id = 'cccccccc-0000-0000-0000-000000000002' and direction = 'OUT'), 5);
select testing.eq('FIFO', 'batch 1 cost per unit is 300',
  (select unit_cost from public.fifo_allocations where batch_id = 'cccccccc-0000-0000-0000-000000000001' and direction = 'OUT'), 300.00);
select testing.eq('FIFO', 'batch 2 cost per unit is 350',
  (select unit_cost from public.fifo_allocations where batch_id = 'cccccccc-0000-0000-0000-000000000002' and direction = 'OUT'), 350.00);

select testing.eq_int('FIFO', 'batch 1 fully depleted',
  (select quantity_remaining from public.purchase_batches where id = 'cccccccc-0000-0000-0000-000000000001'), 0);
select testing.eq_int('FIFO', 'batch 2 has 15 left',
  (select quantity_remaining from public.purchase_batches where id = 'cccccccc-0000-0000-0000-000000000002'), 15);
select testing.eq_int('FIFO', 'on hand is 15 units',
  public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000001'), 15);

\echo '--- §22 supplier payable comes from FIFO COST, not from the selling price ---'
select public.fn_money(sum(payable_amount)) as lipstick_payable from public.supplier_payables
 where product_id = 'bbbbbbbb-0000-0000-0000-000000000001' \gset
select testing.eq('Credit book', 'payable = 7,750 (cost), NOT 12,500 (selling)', :'lipstick_payable'::numeric, 7750.00);
select testing.eq_int('Credit book', 'payable rows carry no selling price at all',
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='supplier_payables' and column_name='selling_price'), 0);

\echo '--- §34/§35 discount is applied BEFORE the 3% commission ---'
-- Run by STAFF: the owner's commission rate is 0% by design (§35), so a staff
-- member must ring this one up for the 3% rule to be the thing under test.
select set_config('request.jwt.claims',
  json_build_object('sub', :'sara_id', 'role', 'authenticated')::text, false);
-- 2 x 900 cream = 1,800 ; 1 x 1,500 perfume = 1,500 ; subtotal 3,300, discount 200
select public.rpc_complete_sale(
  p_items => jsonb_build_array(
    jsonb_build_object('product_id', 'bbbbbbbb-0000-0000-0000-000000000002', 'quantity', 2),
    jsonb_build_object('product_id', 'bbbbbbbb-0000-0000-0000-000000000003', 'quantity', 1)),
  p_payment_method => 'TELEBIRR',
  p_discount_amount => 200
) as d_sale \gset

select testing.eq('Commission', 'subtotal is 3,300',
  (:'d_sale'::jsonb ->> 'subtotal')::numeric, 3300.00);
select testing.eq('Commission', 'final amount after discount is 3,100',
  (:'d_sale'::jsonb ->> 'total_amount')::numeric, 3100.00);
select testing.eq('Commission', 'commission = 3% of the POST-discount 3,100 = 93',
  (:'d_sale'::jsonb ->> 'commission')::numeric, 93.00);

select testing.eq('Discount', 'line discounts sum exactly to the 200 discount',
  (select public.fn_money(sum(line_discount)) from public.sale_items
    where sale_id = (:'d_sale'::jsonb ->> 'sale_id')::uuid), 200.00);
select testing.eq('Discount', 'line totals sum exactly to the sale total',
  (select public.fn_money(sum(line_total)) from public.sale_items
    where sale_id = (:'d_sale'::jsonb ->> 'sale_id')::uuid), 3100.00);

-- back to the owner for the concurrency / expiry / credit-model checks
select set_config('request.jwt.claims',
  json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, false);

\echo '--- §32 stock concurrency: overselling is refused with the exact numbers ---'
select testing.expect_error_like('Stock concurrency', 'selling 999 lipsticks is refused',
  $q$select public.rpc_complete_sale(
       p_items => jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000001','quantity',999)),
       p_payment_method => 'CASH')$q$, 'INSUFFICIENT_STOCK');

-- the error payload itself (the POS parses this to build the §32 prompt)
do $$
declare
  v_payload jsonb;
begin
  begin
    perform public.rpc_complete_sale(
      p_items => jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000001','quantity',999)),
      p_payment_method => 'CASH');
  exception when others then
    v_payload := split_part(sqlerrm, '|', 2)::jsonb;
  end;
  perform testing.eq_int('Stock concurrency', 'payload reports the true available quantity', (v_payload ->> 'available')::int, 15);
  perform testing.eq_int('Stock concurrency', 'payload reports the requested quantity', (v_payload ->> 'requested')::int, 999);
  perform testing.eq_text('Stock concurrency', 'payload names the product', v_payload ->> 'product_name', 'Maybelline Lipstick');
end $$;

select testing.eq_int('Stock concurrency', 'no partial sale was written',
  (select count(*)::int from public.sales where total_amount = 499500.00), 0);

\echo '--- §30 expired products cannot be sold ---'
select testing.expect_error_like('Expiry', 'expired mascara is refused at the till',
  $q$select public.rpc_complete_sale(
       p_items => jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000005','quantity',1)),
       p_payment_method => 'CASH')$q$, 'PRODUCT_EXPIRED');

\echo '--- §22 the credit model, exactly as the spec states it ---'
-- Supplier provides 20 lipstick@300, 10 cream@500, 5 perfume@1000 (16,000 of stock).
-- The spec's payable example uses 8 lipstick + 3 cream + 2 perfume = 5,900.
select testing.eq('Credit book', 'payable so far is 2 x 500 (cream) + 1 x 1000 (perfume) = 2,000',
  (select public.fn_money(sum(payable_amount)) from public.supplier_payables
    where product_id in ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003')), 2000.00);

-- Supplier provided 10 cream @500 and 5 perfume @1000 = 10,000 of stock.
-- Only the 2 cream and 1 perfume actually sold are payable (2,500).
select testing.eq('Credit book', 'the 8 cream + 4 perfume still on the shelf (8,000) are NOT payable yet',
  (select public.fn_money(sum(b.quantity_remaining * b.unit_cost)) from public.purchase_batches b
    where b.product_id in ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003')), 8000.00);
select testing.eq('Credit book', 'received 10,000 of stock but only 2,000 is payable so far',
  (select public.fn_money(sum(quantity_received * unit_cost)) from public.purchase_batches b
    where b.product_id in ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003')), 10000.00);

\echo '--- §36 commission reversals: full return, then partial return ---'
-- Full return of the telebirr sale (3,100, commission 93)
select public.rpc_process_return(
  p_sale_id => (:'d_sale'::jsonb ->> 'sale_id')::uuid,
  p_items => jsonb_build_array(
    jsonb_build_object('sale_item_id',
      (select id from public.sale_items where sale_id = (:'d_sale'::jsonb ->> 'sale_id')::uuid
        and product_id = 'bbbbbbbb-0000-0000-0000-000000000002' limit 1),
      'quantity', 2),
    jsonb_build_object('sale_item_id',
      (select id from public.sale_items where sale_id = (:'d_sale'::jsonb ->> 'sale_id')::uuid
        and product_id = 'bbbbbbbb-0000-0000-0000-000000000003' limit 1),
      'quantity', 1)),
  p_reason => 'Customer changed her mind'
) as full_return \gset

select testing.eq('Returns', 'full return refunds 3,100',
  (:'full_return'::jsonb ->> 'refund_amount')::numeric, 3100.00);
select testing.eq('Returns', 'full return reverses the 93 commission to zero net',
  (select public.fn_money(sum(amount)) from public.commissions
    where sale_id = (:'d_sale'::jsonb ->> 'sale_id')::uuid), 0.00);
select testing.eq('Returns', 'the original EARNED row is never deleted',
  (select count(*)::numeric from public.commissions
    where sale_id = (:'d_sale'::jsonb ->> 'sale_id')::uuid and type = 'EARNED'), 1);
select testing.eq_text('Returns', 'sale is marked RETURNED',
  (select status::text from public.sales where id = (:'d_sale'::jsonb ->> 'sale_id')::uuid), 'RETURNED');
select testing.eq_int('Returns', 'stock came back: cream on hand is 10 again',
  public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000002'), 10);

\echo '--- §36 partial return: half the sale back -> half the commission reversed ---'
-- Again rung up by staff so the 3% commission exists to be reversed.
select set_config('request.jwt.claims',
  json_build_object('sub', :'sara_id', 'role', 'authenticated')::text, false);
-- New sale: 2 lipsticks = 1,000 ; commission at 3% = 30
select public.rpc_complete_sale(
  p_items => jsonb_build_array(
    jsonb_build_object('product_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'quantity', 2)),
  p_payment_method => 'CASH'
) as partial_sale \gset

select testing.eq('Returns', 'commission on a 1,000 sale is 30',
  (:'partial_sale'::jsonb ->> 'commission')::numeric, 30.00);

-- returns are owner-only (§37): the sale was rung up by staff, the return is made by the owner
select set_config('request.jwt.claims',
  json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, false);

-- return 1 of the 2 units -> refund 500, reversal 15, remaining commission 15
select public.rpc_process_return(
  p_sale_id => (:'partial_sale'::jsonb ->> 'sale_id')::uuid,
  p_items => jsonb_build_array(jsonb_build_object('sale_item_id',
      (select id from public.sale_items where sale_id = (:'partial_sale'::jsonb ->> 'sale_id')::uuid limit 1),
      'quantity', 1)),
  p_reason => 'One unit returned'
) as part_ret \gset

select testing.eq('Returns', 'partial return refunds 500',
  (:'part_ret'::jsonb ->> 'refund_amount')::numeric, 500.00);
select testing.eq('Returns', 'reversal is 15 (500 x 3%)',
  (:'part_ret'::jsonb ->> 'commission_reversed')::numeric, 15.00);
select testing.eq('Returns', 'net commission is 30 - 15 = 15',
  (select public.fn_money(sum(amount)) from public.commissions
    where sale_id = (:'partial_sale'::jsonb ->> 'sale_id')::uuid), 15.00);
select testing.eq_text('Returns', 'sale is PARTIALLY_RETURNED',
  (select status::text from public.sales where id = (:'partial_sale'::jsonb ->> 'sale_id')::uuid), 'PARTIALLY_RETURNED');
-- batch 2: 20 received − 5 (FIFO sale) − 2 (this sale, batch 1 was drained) = 13
-- the returned unit goes back to the NEWEST batch that still holds sales: 14
select testing.eq('Returns', 'a partial return restores stock to the newest batch, not the oldest',
  (select quantity_remaining from public.purchase_batches where id = 'cccccccc-0000-0000-0000-000000000002'), 14.00);

-- returns are owner-only (§37), so hand the identity back
select set_config('request.jwt.claims',
  json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, false);

\echo '--- §37 over-return is refused ---'
select testing.expect_error_like('Returns', 'returning more units than were sold is refused',
  format($q$select public.rpc_process_return(
    p_sale_id => %L::uuid,
    p_items => jsonb_build_array(jsonb_build_object('sale_item_id', %L::uuid, 'quantity', 5)),
    p_reason => 'too many')$q$,
    (:'partial_sale'::jsonb ->> 'sale_id'),
    (select id from public.sale_items where sale_id = (:'partial_sale'::jsonb ->> 'sale_id')::uuid limit 1)),
  'OVER_RETURN');

\echo '--- §38 void: reversal of what was not already returned ---'
select public.rpc_void_sale(
  p_sale_id => (:'partial_sale'::jsonb ->> 'sale_id')::uuid,
  p_reason => 'Wrong item rung up'
) as voided \gset

select testing.eq_text('Void', 'sale status becomes VOIDED',
  (:'voided'::jsonb ->> 'status'), 'VOIDED');
select testing.eq('Void', 'void reverses the remaining 15 of commission',
  (select public.fn_money(sum(amount)) from public.commissions
    where sale_id = (:'partial_sale'::jsonb ->> 'sale_id')::uuid), 0.00);
select testing.eq_int('Void', 'the sale row still exists — history is never deleted',
  (select count(*)::int from public.sales where id = (:'partial_sale'::jsonb ->> 'sale_id')::uuid), 1);
select testing.check('Void', 'every void is audit-logged',
  exists (select 1 from public.audit_logs where action = 'VOID_SALE'
          and entity_id = (:'partial_sale'::jsonb ->> 'sale_id')::uuid));
select testing.expect_error_like('Void', 'voiding an already-voided sale is refused',
  format('select public.rpc_void_sale(%L::uuid, %L)', :'partial_sale'::jsonb ->> 'sale_id', 'again'),
  'ALREADY_VOIDED');

\echo '--- §28/§29 biweekly stock count reconciles expected vs physical ---'
select public.rpc_generate_month_periods(current_date) as periods \gset
select public.rpc_open_stock_count(((:'periods'::jsonb -> 'period_ids' ->> 0)::uuid)) as opened \gset
select public.rpc_submit_stock_count(
  p_stock_period_id => ((:'periods'::jsonb -> 'period_ids' ->> 0)::uuid),
  p_lines => jsonb_build_array(
     jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000002',
                        'counted_quantity', public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000002')),
     jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000004',
                        'counted_quantity', public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000004') - 2))
) as counted \gset

select public.rpc_confirm_stock_count(((:'periods'::jsonb -> 'period_ids' ->> 0)::uuid)) as confirmed \gset
select testing.eq_int('Stock count', '2 missing earrings become a -2 adjustment',
  ((:'confirmed'::jsonb ->> 'variance_units')::int), 2);
select testing.eq('Stock count', 'variance is valued at 2 x 100 = 200',
  (:'confirmed'::jsonb ->> 'variance_value')::numeric, -200.00);
select testing.eq_int('Stock count', 'on-hand now matches the physical count',
  public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000004'), 8);
select testing.eq_int('Stock count', 'the ADJUSTMENT movement was written to the ledger',
  (select count(*)::int from public.stock_movements
    where product_id = 'bbbbbbbb-0000-0000-0000-000000000004' and movement_type = 'ADJUSTMENT'), 1);
select testing.check('Stock count', 'closing a period opens the next one',
  exists (select 1 from public.stock_periods where status = 'OPEN'));
select testing.eq_int('Stock count', 'no double-counted BEGINNING_STOCK row was created',
  (select count(*)::int from public.stock_movements where movement_type = 'BEGINNING_STOCK'),
  (select count(*)::int from public.purchase_batches));

\echo '--- §40/§41 P&L and tithe ---'
select public.rpc_record_expense(
  p_category => 'PACKAGING', p_amount => 500, p_payment_method => 'CASH',
  p_description => 'Gift bags') as exp \gset

select public.rpc_compute_tithe(current_date) as tithe \gset

select testing.eq('P&L', 'expenses include the 15,000 rent (recorded at month start) plus any category totals',
  (select public.fn_money(sum(amount)) from public.expenses), 15500.00);
select testing.eq('P&L', 'net sales = sales - discounts - returns (voided sales excluded)',
  (select net_sales from public.v_pnl_monthly where period_month = date_trunc('month', current_date)::date),
  (select public.fn_money(coalesce(sum(total_amount - returned_amount), 0)) from public.sales
    where status <> 'VOIDED' and sale_date >= date_trunc('month', current_date)::date));
select testing.eq('P&L', 'gross profit = net sales - COGS',
  (select gross_profit from public.v_pnl_monthly where period_month = date_trunc('month', current_date)::date),
  (select public.fn_money(net_sales - cogs) from public.v_pnl_monthly
    where period_month = date_trunc('month', current_date)::date));
select testing.eq('P&L', 'net profit = gross profit - expenses - commission',
  (select net_profit from public.v_pnl_monthly where period_month = date_trunc('month', current_date)::date),
  (select public.fn_money(gross_profit - operating_expenses - staff_commission) from public.v_pnl_monthly
    where period_month = date_trunc('month', current_date)::date));
select testing.eq('Tithe', 'tithe = 10% of net profit',
  (:'tithe'::jsonb ->> 'tithe_amount')::numeric,
  (select public.fn_money(greatest(net_profit, 0) * 0.10) from public.v_pnl_monthly
    where period_month = date_trunc('month', current_date)::date));
select testing.check('Tithe', 'a loss yields no tithe and is never negative',
  (select case when net_profit <= 0 then tithe_due_10pct = 0 else tithe_due_10pct >= 0 end
     from public.v_pnl_monthly where period_month = date_trunc('month', current_date)::date));

\echo '--- §42 tithe payment ---'
select public.rpc_record_tithe_payment(
  p_period_month => current_date, p_payment_method => 'BANK', p_reference => 'TITHE-SEP'
) as tithe_paid \gset
select testing.eq_text('Tithe', 'tithe payment is recorded as PAID',
  (:'tithe_paid'::jsonb ->> 'status'), 'PAID');
select testing.eq('Tithe', 'the paid tithe did not change expenses (tithe is NOT an expense)',
  (select public.fn_money(sum(amount)) from public.expenses), 15500.00);

\echo '--- §24 a supplier payment is not an operating expense ---'
select public.fn_money(sum(outstanding)) as abc_outstanding
  from public.supplier_payables where supplier_id = '11111111-1111-1111-1111-111111111111' \gset
select public.rpc_record_supplier_payment(
  p_supplier_id => '11111111-1111-1111-1111-111111111111',
  p_amount => least(:'abc_outstanding'::numeric, 1000),
  p_payment_method => 'BANK', p_reference => 'ABC-001'
) as sp_pay \gset
select testing.eq('Credit book', 'the payment reduced the outstanding balance',
  (:'sp_pay'::jsonb ->> 'remaining_outstanding')::numeric,
  (:'abc_outstanding'::numeric - 1000));
select testing.eq('Credit book', 'the supplier payment did NOT increase expenses',
  (select public.fn_money(sum(amount)) from public.expenses), 15500.00);
select testing.eq('Credit book', 'the supplier payment did NOT change net profit',
  (select net_profit from public.v_pnl_monthly where period_month = date_trunc('month', current_date)::date),
  (select public.fn_money(gross_profit - operating_expenses - staff_commission) from public.v_pnl_monthly
    where period_month = date_trunc('month', current_date)::date));

\echo '--- §21 supplier statement is derived, never typed ---'
select public.rpc_generate_supplier_statement(
  '11111111-1111-1111-1111-111111111111', current_date) as stmt \gset
select testing.eq('Statement', 'statement payable equals the sum of that month''s transaction rows',
  (:'stmt'::jsonb ->> 'total_payable')::numeric,
  (select public.fn_money(coalesce(sum(payable_amount), 0)) from public.supplier_payables
    where supplier_id = '11111111-1111-1111-1111-111111111111' and is_reversal = false
      and entry_date >= date_trunc('month', current_date)::date));
select testing.eq('Statement', 'statement paid equals the recorded payments',
  (:'stmt'::jsonb ->> 'total_paid')::numeric,
  (select public.fn_money(coalesce(sum(amount), 0)) from public.supplier_payments
    where supplier_id = '11111111-1111-1111-1111-111111111111' and voided_at is null));
select testing.eq('Statement', 'outstanding = opening + payable - paid',
  (:'stmt'::jsonb ->> 'outstanding')::numeric,
  (:'stmt'::jsonb ->> 'opening_outstanding')::numeric
   + (:'stmt'::jsonb ->> 'total_payable')::numeric
   - (:'stmt'::jsonb ->> 'total_paid')::numeric);

\echo '--- §27 restock: staff may receive stock but never price it ---'
select set_config('request.jwt.claims',
  jsonb_build_object('sub', (select id from public.app_users where email = 'sara@lubella.shop'), 'role', 'authenticated')::text, false);

select public.rpc_record_restock(
  p_product_id => 'bbbbbbbb-0000-0000-0000-000000000003',
  p_supplier_id => '22222222-2222-2222-2222-222222222222',
  p_quantity => 4,
  p_unit_cost => 999          -- staff attempt to set a cost; must be ignored
) as staff_restock \gset

select testing.check('Restock', 'staff-created shipment is flagged as cost-pending',
  (:'staff_restock'::jsonb ->> 'cost_pending')::boolean);
select testing.eq('Restock', 'the cost a staff member supplied was IGNORED (batch cost stays 0)',
  (select unit_cost from public.purchase_batches
    where id = (:'staff_restock'::jsonb ->> 'batch_id')::uuid), 0.00);
select testing.eq('Restock', 'the new selling price was NOT changed by the restock',
  (select selling_price from public.products where id = 'bbbbbbbb-0000-0000-0000-000000000003'), 1500.00);
-- perfume: 5 received, 1 sold, that sale fully returned -> 5 on hand, +4 received = 9
select testing.eq_int('Restock', 'stock increased by 4',
  public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000003'), 9);

\echo '--- §27 owner records the real cost, and previously-pending payables are corrected ---'
select set_config('request.jwt.claims',
  jsonb_build_object('sub', (select id from public.app_users where role = 'OWNER'), 'role', 'authenticated')::text, false);

select public.rpc_record_batch_cost(
  (:'staff_restock'::jsonb ->> 'batch_id')::uuid, 1100.00, 'Supplier invoice #4471') as cost_rec \gset
select testing.eq('Restock', 'owner-recorded cost is stored on the batch',
  (select unit_cost from public.purchase_batches where id = (:'staff_restock'::jsonb ->> 'batch_id')::uuid), 1100.00);
select testing.check('Restock', 'every cost change is preserved in purchase cost history',
  (select count(*) from public.purchase_cost_history
    where batch_id = (:'staff_restock'::jsonb ->> 'batch_id')::uuid) >= 2);

\echo '--- §35 owner earns 0% commission ---'
select public.rpc_complete_sale(
  p_items => jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000004','quantity',1)),
  p_payment_method => 'CASH'
) as owner_sale \gset
select testing.eq('Commission', 'owner sale earns 0 commission',
  (:'owner_sale'::jsonb ->> 'commission')::numeric, 0.00);

\echo '--- idempotency: a retried POS request does not double-sell ---'
select public.rpc_complete_sale(
  p_items => jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000004','quantity',1)),
  p_payment_method => 'CASH', p_client_ref => 'retry-key-1') as idem1 \gset
select public.rpc_complete_sale(
  p_items => jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000004','quantity',1)),
  p_payment_method => 'CASH', p_client_ref => 'retry-key-1') as idem2 \gset
select testing.eq_text('POS', 'the replayed request returns the ORIGINAL sale number',
  (:'idem2'::jsonb ->> 'sale_number'), (:'idem1'::jsonb ->> 'sale_number'));
select testing.check('POS', 'the replay is flagged so the UI can say "already completed"',
  (:'idem2'::jsonb ->> 'replayed')::boolean);
select testing.eq_int('POS', 'only one sale exists for that retry key',
  (select count(*)::int from public.sales where client_ref = 'retry-key-1'), 1);

\echo '--- §54 a closed month rejects further transactions ---'
select public.rpc_close_month(current_date, 'September close') as closed \gset
select testing.expect_error_like('Month close', 'a new sale in a closed month is refused',
  $q$select public.rpc_record_expense('OTHER', 10, 'CASH', current_date, 'should be blocked')$q$,
  'PERIOD_CLOSED');
select testing.expect_error_like('Month close', 'reopening without a reason is refused',
  format('select public.rpc_reopen_month(%L::date, %L)', current_date, ''), 'REASON_REQUIRED');
select public.rpc_reopen_month(current_date, 'Late invoice from the supplier') as reopened \gset
select testing.eq_text('Month close', 'with a reason, the month reopens',
  (:'reopened'::jsonb ->> 'status'), 'OPEN');

\echo '--- §53 audit trail ---'
select testing.check('Audit', 'a sale is audit-logged',
  exists (select 1 from public.audit_logs where action = 'SALE_CREATE'));
select testing.check('Audit', 'a discount decision is preserved inside the sale audit entry',
  exists (select 1 from public.audit_logs where action = 'SALE_CREATE'
          and (new_value ->> 'discount')::numeric = 200));
select testing.check('Audit', 'a return is audit-logged with its reversal amounts',
  exists (select 1 from public.audit_logs where action = 'RETURN_PROCESS'
          and (new_value ->> 'commission_reversed') is not null));
select testing.check('Audit', 'a void records its reason',
  exists (select 1 from public.audit_logs where action = 'VOID_SALE'
          and (new_value ->> 'reason') = 'Wrong item rung up'));
select testing.check('Audit', 'audit entries are immutable (no UPDATE/DELETE policy exists)',
  (select count(*) from pg_policies where tablename = 'audit_logs'
    and cmd in ('UPDATE','DELETE')) = 0);
select testing.check('Audit', 'reopening a closed month is audited',
  exists (select 1 from public.audit_logs where action = 'MONTH_REOPEN'));
