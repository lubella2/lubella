-- ============================================================================
-- LuBella  |  Security / RLS tests  (spec §52, §62)
-- ============================================================================
-- These tests switch the actual PostgreSQL role, so RLS and table privileges
-- are both genuinely in force. They are the evidence for the promise that staff
-- cannot reach cost data "through browser developer tools or direct API calls":
-- they attempt exactly that, as each role, straight against the database.
-- ============================================================================

\set ON_ERROR_STOP on

-- Capture identities while still superuser (RLS applies the moment we switch).
select id as owner_id    from public.app_users where role = 'OWNER' \gset
select id as sara_id     from public.app_users where email = 'sara@lubella.shop' \gset
select id as hana_id     from public.app_users where email = 'hana@lubella.shop' \gset
select id as abc_user_id from public.app_users where email = 'abc@supplier.et' \gset
select id as xyz_user_id from public.app_users where email = 'xyz@supplier.et' \gset
-- A sale owned by staff, captured here because once the session is `authenticated`
-- with a staff token, RLS makes public.sales unreadable to them.
select id as sara_sale_id from public.sales where staff_id = :'sara_id'::uuid limit 1 \gset
select coalesce(max(id::text), 'NONE') as hana_sale_id from public.sales where staff_id = :'hana_id'::uuid \gset

-- ===========================================================================
-- 1. ANONYMOUS CUSTOMER
-- ===========================================================================
\echo '--- customer (anon), no account ---'
set role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);

select testing.check('Customer', 'can browse the public catalog without logging in',
  (select count(*) from public.public_products) > 0);
select testing.check('Customer', 'can read public categories',
  (select count(*) from public.public_categories) > 0);
select testing.eq_int('Customer', 'the catalog exposes NO cost column at all',
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'public_products'
      and column_name in ('unit_cost','purchase_cost','cogs','cost','supplier_id','supplier_name')), 0);
select testing.eq_int('Customer', 'the catalog exposes NO exact stock quantity',
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'public_products'
      and column_name in ('quantity_on_hand','quantity_remaining','stock_on_hand')), 0);
select testing.check('Customer', 'the catalog DOES expose the availability band',
  (select bool_and(availability in ('AVAILABLE','LOW','OUT')) from public.public_products));
select testing.check('Customer', 'availability shows the spec''s traffic-light labels',
  (select bool_and(availability_label in ('🟢 Available','🟡 Low Stock','🔴 Out of Stock'))
     from public.public_products));

select testing.expect_error('Customer', 'customer cannot read exact stock quantities at all',
  $q$select public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000001')$q$);
select testing.expect_error('Customer', 'customer cannot read the average cost helper',
  $q$select public.fn_avg_unit_cost('bbbbbbbb-0000-0000-0000-000000000001')$q$);
select testing.check('Customer', 'the availability wrapper returns only a band, never a number',
  (select bool_and(public.fn_public_availability(id, 1) in ('AVAILABLE','LOW','OUT'))
     from public.public_products));
select testing.expect_error('Customer', 'cannot read the products table directly (no grant)',
  'select selling_price from public.products limit 1');
select testing.expect_error('Customer', 'cannot read customer requests (phone numbers)',
  'select * from public.customer_requests limit 1');
select testing.expect_error('Customer', 'cannot read suppliers',
  'select * from public.suppliers limit 1');
select testing.expect_error('Customer', 'cannot read purchase batches',
  'select * from public.purchase_batches limit 1');
select testing.expect_error('Customer', 'cannot read sales',
  'select * from public.sales limit 1');
select testing.expect_error('Customer', 'cannot read app_users',
  'select * from public.app_users limit 1');
select testing.expect_error('Customer', 'cannot read settings (bot token lives here)',
  'select * from public.settings limit 1');
select testing.expect_error('Customer', 'cannot call the owner dashboard',
  'select public.rpc_owner_dashboard()');
select testing.expect_error('Customer', 'cannot call the P&L report',
  'select public.rpc_report_pnl()');
select testing.expect_error('Customer', 'cannot call complete_sale',
  $q$select public.rpc_complete_sale(jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000001','quantity',1)), 'CASH')$q$);
select testing.expect_error('Customer', 'cannot call fn_setting (would leak the bot token)',
  $q$select public.fn_setting('telegram_bot_token')$q$);
select testing.check('Customer', 'the public settings wrapper cannot return a private key',
  (public.fn_public_setting('telegram_bot_token')) is null);
select testing.expect_error('Customer', 'cannot read the audit log',
  'select * from public.audit_logs limit 1');

-- public config is reachable, but only the public keys
select testing.check('Customer', 'public settings are readable for the contact page',
  (public.fn_public_settings() ? 'whatsapp_number'));
select testing.check('Customer', 'the Telegram bot TOKEN is not in the public settings',
  not (public.fn_public_settings() ? 'telegram_bot_token'));

-- order messaging works end to end for an anonymous customer
select public.rpc_build_order_message(
  jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000001','quantity',2)),
  'Sara', '0911223344') as wa \gset
select testing.check('Customer', 'a WhatsApp deep link is generated for the order',
  (:'wa'::jsonb -> 'links' ->> 'whatsapp_url') like 'https://wa.me/251911223344?text=%');
select testing.check('Customer', 'a Telegram link is generated for the order',
  (:'wa'::jsonb -> 'links' ->> 'telegram_url') like 'https://t.me/%');
select testing.check('Customer', 'the generated message names the product and quantity',
  (:'wa'::jsonb ->> 'message') like '%Maybelline Lipstick%' and (:'wa'::jsonb ->> 'message') like '%Quantity: 2%');
select testing.check('Customer', 'the total is labelled an estimate',
  (:'wa'::jsonb ->> 'estimate_note') like '%estimate%');

-- ===========================================================================
-- 2. THE CUSTOMER REQUEST PATH (and the rule it must NOT break)
-- ===========================================================================
\echo '--- customer request: records demand, never moves stock ---'

-- captured as the owner: the whole point is that anon CANNOT call fn_on_hand,
-- so the baseline has to be taken from outside the customer's view.
reset role;
select public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000006') as stock_before_unavail \gset
set role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);

select public.rpc_submit_customer_request(
  p_requested_product_name => 'Foundation',
  p_quantity => 1,
  p_customer_name => 'Sara',
  p_customer_phone => '0911223344',
  p_product_id => 'bbbbbbbb-0000-0000-0000-000000000006',
  p_source => 'WEBSITE'
) as req \gset

select testing.check('Customer request', 'an anonymous request is accepted',
  (:'req'::jsonb ->> 'request_number') like 'CR-%');
select testing.check('Customer request', 'the request returns ready-to-send WhatsApp + Telegram links',
  (:'req'::jsonb -> 'links' ->> 'whatsapp_url') is not null
  and (:'req'::jsonb -> 'links' ->> 'telegram_url') is not null);
select testing.check('Customer request', 'the message reads as a request, not an order',
  (:'req'::jsonb ->> 'message') like '%I would like to request%'
  and (:'req'::jsonb ->> 'message') like '%Please notify me when available%');
select testing.expect_error_like('Customer request', 'a phone number is mandatory so LuBella can reply',
  $q$select public.rpc_submit_customer_request('Some Lipstick', 1, 'No Phone', null)$q$, 'PHONE_REQUIRED');

-- The critical rule (§9, §60): submitting a request must not touch inventory.
-- Verified from outside the customer's role, since a customer cannot read stock
-- at all — which is itself the first half of the guarantee.
reset role;
select public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000006') as stock_after_unavail \gset
select testing.eq_int('Customer request', 'submitting a request does NOT deduct stock',
  :'stock_after_unavail'::int, :'stock_before_unavail'::int);
select testing.eq_int('Customer request', 'no stock movement was created by the request',
  (select count(*)::int from public.stock_movements
    where product_id = 'bbbbbbbb-0000-0000-0000-000000000006' and reference_type = 'request'), 0);
select testing.check('Customer request', 'a request for an in-stock product is not flagged unavailable',
  (select not was_unavailable from public.customer_requests
    where request_number = (:'req'::jsonb ->> 'request_number')));
select testing.check('Customer request', 'and the product is NOT out of stock in reality',
  public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000006') > 0);
-- back to the anonymous customer for the rate-limit checks
set role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);

-- A genuinely unavailable product (expired => cannot be sold) must be flagged,
-- which is what feeds the customer-demand analytics.
select public.rpc_submit_customer_request(
  p_requested_product_name => 'Expired Mascara',
  p_quantity => 1,
  p_customer_name => 'Hana',
  p_customer_phone => '0912000111',
  p_product_id => 'bbbbbbbb-0000-0000-0000-000000000005',
  p_source => 'WHATSAPP'
) as req2 \gset
reset role;
-- demand analytics are internal-only (§13), so these run with the owner's claims
select set_config('request.jwt.claims',
  json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, false);
select testing.check('Customer request', 'an unavailable (expired) product is flagged as unavailable',
  (select was_unavailable from public.customer_requests
    where request_number = (:'req2'::jsonb ->> 'request_number')));
select testing.check('Demand', 'demand analytics rank the requested product',
  (select count(*) from jsonb_array_elements(public.rpc_report_customer_demand(90, false) -> 'items')) > 0);
select testing.check('Demand', 'the owner sees the «N customers have requested this product» message',
  (select bool_or((item ->> 'demand_message') like '%customer%requested this product%')
     from jsonb_array_elements(public.rpc_report_customer_demand(90, false) -> 'items') item));
select testing.check('Customer request', 'a source of WHATSAPP is recorded for channel attribution',
  (select source = 'WHATSAPP' from public.customer_requests
    where request_number = (:'req2'::jsonb ->> 'request_number')));
set role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);

-- rate limiting on the public endpoint
do $$
declare i int;
begin
  for i in 1..5 loop
    begin
      perform public.rpc_submit_customer_request('Rate Limit Test', 1, 'Spammer', '0999000111');
    exception when others then null;
    end;
  end loop;
  begin
    perform public.rpc_submit_customer_request('Rate Limit Test', 1, 'Spammer', '0999000111');
    perform testing.check('Customer request', 'the public endpoint is rate limited per phone number', false, 'a 6th request was accepted');
  exception when others then
    perform testing.check('Customer request', 'the public endpoint is rate limited per phone number',
      sqlerrm like '%RATE_LIMITED%', sqlerrm);
  end;
end $$;

-- ===========================================================================
-- 3. STAFF
-- ===========================================================================
\echo '--- staff ---'
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'sara_id', 'role', 'authenticated')::text, false);

select testing.check('Staff', 'staff can see their own profile row only',
  (select count(*) = 1 and bool_and(id = :'sara_id'::uuid) from public.app_users));

select testing.check('Staff', 'staff CAN see selling prices and stock levels',
  (select bool_and(selling_price > 0) from public.v_staff_products));

-- The central promise: no cost information, at any level.
select testing.expect_error('Staff cost wall', 'purchase_batches has no staff grant at all',
  'select unit_cost from public.purchase_batches limit 1');
select testing.expect_error('Staff cost wall', 'restocks has no staff grant at all',
  'select unit_cost from public.restocks limit 1');
select testing.expect_error('Staff cost wall', 'the owner-only batch listing RPC is refused to staff',
  'select public.rpc_list_batches()');
select testing.expect_error('Staff cost wall', 'fifo_allocations is unreachable',
  'select * from public.fifo_allocations limit 1');
select testing.expect_error('Staff cost wall', 'supplier_payables is unreachable',
  'select * from public.supplier_payables limit 1');
select testing.expect_error('Staff cost wall', 'supplier_payments is unreachable',
  'select * from public.supplier_payments limit 1');
select testing.expect_error('Staff cost wall', 'stock_movements is unreachable',
  'select * from public.stock_movements limit 1');
select testing.expect_error('Staff cost wall', 'returns are unreachable',
  'select * from public.returns limit 1');
select testing.expect_error('Staff cost wall', 'purchase_cost_history is unreachable',
  'select * from public.purchase_cost_history limit 1');
select testing.expect_error('Staff cost wall', 'stock_counts valuation is unreachable',
  'select * from public.stock_counts limit 1');
select testing.expect_error('Staff cost wall', 'the COGS report is owner-only',
  'select public.rpc_report_fifo_cogs()');
select testing.expect_error('Staff cost wall', 'the P&L report is owner-only',
  'select public.rpc_report_pnl()');
select testing.expect_error('Staff cost wall', 'fn_avg_unit_cost is not callable by staff',
  $q$select public.fn_avg_unit_cost('bbbbbbbb-0000-0000-0000-000000000001')$q$);
select testing.expect_error('Staff cost wall', 'fn_on_hand is not callable by staff (they use the view)',
  $q$select public.fn_on_hand('bbbbbbbb-0000-0000-0000-000000000001')$q$);

-- staff-visible views must contain no cost columns at all
select testing.eq_int('Staff cost wall', 'v_staff_products has no cost column',
  (select count(*)::int from information_schema.columns where table_schema='public'
    and table_name='v_staff_products'
    and column_name in ('unit_cost','purchase_cost','cogs','line_cogs','avg_unit_cost','stock_value')), 0);
select testing.eq_int('Staff cost wall', 'v_staff_sales has no cogs or profit column',
  (select count(*)::int from information_schema.columns where table_schema='public'
    and table_name='v_staff_sales'
    and column_name in ('cogs_amount','gross_profit','line_cogs')), 0);
select testing.eq_int('Staff cost wall', 'v_staff_restocks has no cost column',
  (select count(*)::int from information_schema.columns where table_schema='public'
    and table_name='v_staff_restocks'
    and column_name in ('unit_cost','previous_unit_cost')), 0);

-- RLS-scoped tables: zero rows rather than data
select testing.eq_int('Staff cost wall', 'expenses return zero rows for staff',
  (select count(*)::int from public.expenses), 0);
select testing.eq_int('Staff cost wall', 'tithe records return zero rows for staff',
  (select count(*)::int from public.tithe_records), 0);
select testing.eq_int('Staff cost wall', 'sales table returns zero rows for staff (cogs lives there)',
  (select count(*)::int from public.sales), 0);
select testing.eq_int('Staff cost wall', 'sale_items returns zero rows for staff',
  (select count(*)::int from public.sale_items), 0);
select testing.eq_int('Staff cost wall', 'the audit log returns zero rows for staff',
  (select count(*)::int from public.audit_logs), 0);
select testing.eq_int('Staff cost wall', 'settings returns only the public rows',
  (select count(*)::int from public.settings where not is_public), 0);
select testing.check('Staff cost wall', 'the Telegram bot token is NOT among the settings staff can read',
  not exists (select 1 from public.settings where key = 'telegram_bot_token'));
select testing.expect_error('Staff cost wall', 'the owner inventory valuation view is not even granted',
  'select * from public.v_owner_inventory limit 1');
select testing.expect_error('Staff cost wall', 'the owner P&L view is not even granted',
  'select * from public.v_pnl_monthly limit 1');
select testing.expect_error('Staff cost wall', 'the supplier balance view is not even granted',
  'select * from public.v_owner_supplier_balance limit 1');
select testing.expect_error('Staff cost wall', 'the owner inventory report RPC is refused',
  'select public.rpc_report_inventory()');
select testing.expect_error('Staff cost wall', 'the expenses report RPC is refused',
  'select public.rpc_report_expenses()');

select testing.eq_int('Staff cost wall', 'the supplier portal returns nothing for staff',
  (select count(*)::int from public.supplier_portal_summary where supplier_id is not null), 0);

-- staff may see their own work
select testing.check('Staff scope', 'staff see their own commission ledger',
  (select count(*) from public.v_staff_commissions) > 0);
select testing.check('Staff scope', 'staff see ONLY their own commissions',
  (select bool_and(staff_id = :'sara_id'::uuid) from public.v_staff_commissions));
select testing.check('Staff scope', 'staff see only their own sales',
  (select count(*) > 0 and bool_and(staff_id = :'sara_id'::uuid) from public.v_staff_sales));
select testing.check('Staff scope', 'staff cannot see another staff member''s commissions at the table level',
  (select count(*) = 0 from public.commissions where staff_id <> :'sara_id'::uuid));
select testing.check('Staff scope', 'staff can see customer requests to process them',
  (select count(*) from public.customer_requests) > 0);

-- staff cannot perform owner actions
select testing.expect_error('Staff limits', 'staff cannot process a return',
  $q$select public.rpc_process_return('00000000-0000-0000-0000-000000000000'::uuid, jsonb_build_array(), 'x')$q$);
select testing.expect_error('Staff limits', 'staff cannot void a sale',
  $q$select public.rpc_void_sale('00000000-0000-0000-0000-000000000000'::uuid, 'x')$q$);
select testing.expect_error('Staff limits', 'staff cannot record an expense',
  $q$select public.rpc_record_expense('RENT', 100, 'CASH')$q$);
select testing.expect_error('Staff limits', 'staff cannot pay a supplier',
  $q$select public.rpc_record_supplier_payment('11111111-1111-1111-1111-111111111111'::uuid, 100, 'CASH')$q$);
select testing.expect_error('Staff limits', 'staff cannot record a purchase cost',
  $q$select public.rpc_record_batch_cost('cccccccc-0000-0000-0000-000000000002'::uuid, 999)$q$);
select testing.expect_error('Staff limits', 'staff cannot adjust stock',
  $q$select public.rpc_adjust_stock('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 5, 'ADJUSTMENT', 'x')$q$);
select testing.expect_error('Staff limits', 'staff cannot change settings',
  $q$select public.rpc_update_settings('{"whatsapp_number":"+251900000000"}')$q$);
select testing.expect_error('Staff limits', 'staff cannot create staff accounts',
  $q$select public.rpc_register_app_user(gen_random_uuid(), 'x@y.z', 'X', 'STAFF')$q$);
select testing.expect_error('Staff limits', 'staff cannot close the month',
  'select public.rpc_close_month(current_date)');
select testing.eq_int('Staff limits', 'the API surface listing is empty for staff',
  (select count(*)::int from jsonb_object_keys(public.rpc_api_surface())), 0);

-- sale detail: the cost fields must be absent from the PAYLOAD for staff, not
-- merely hidden in the UI. `->>` (not `->`) is used deliberately: JSON null is
-- not SQL NULL, so `->` would report a non-null value for a hidden field.
select testing.check('Staff cost wall', 'staff opening their own sale gets NO cogs in the payload',
  (public.rpc_sale_detail(:'sara_sale_id'::uuid)->'sale'->>'cogs_amount') is null);
select testing.check('Staff cost wall', 'staff gets NO gross profit in the payload',
  (public.rpc_sale_detail(:'sara_sale_id'::uuid)->'sale'->>'gross_profit') is null);
select testing.check('Staff cost wall', 'staff gets NO per-line cost in the payload',
  (public.rpc_sale_detail(:'sara_sale_id'::uuid)->'items'->0->>'line_cogs') is null);
select testing.check('Staff cost wall', 'the payload tells the UI why cost is missing',
  (public.rpc_sale_detail(:'sara_sale_id'::uuid)->>'cost_visible')::boolean = false);
select testing.check('Staff cost wall', 'staff CAN still open their OWN sale (sale number present)',
  (public.rpc_sale_detail(:'sara_sale_id'::uuid)->'sale'->>'sale_number') like 'S-%');
select testing.check('Staff scope', 'staff can read their own sales history',
  jsonb_array_length(public.rpc_my_sales(10) -> 'items') >= 0);
select testing.check('Staff scope', 'sales history carries no cost keys at all',
  not ((public.rpc_my_sales(1) -> 'items' -> 0) ?| array['cogs_amount','gross_profit','line_cogs']));
select testing.check('Staff scope', 'staff can read their own commission ledger',
  (public.rpc_my_commission() -> 'totals' ->> 'net') is not null);
select testing.check('Staff scope', 'commission ledger separates earned from reversed',
  (public.rpc_my_commission() -> 'totals' -> 'earned') is not null
  and (public.rpc_my_commission() -> 'totals' -> 'reversed') is not null);

select testing.check('Staff cost wall', 'staff CANNOT open a sale belonging to another staff member',
  (select testing.expect_error_like('Staff cost wall',
     'another staff member''s sale is refused',
     format('select public.rpc_sale_detail(%L::uuid)', :'hana_sale_id'), 'NOT_YOUR_SALE')) = true
  or :'hana_sale_id' = 'NONE');

-- but staff CAN ring up a sale, which is their job
select testing.check('Staff scope', 'staff CAN read real stock numbers through the staff view',
  (select bool_and(quantity_on_hand is not null) from public.v_staff_products));
select testing.check('Staff scope', 'staff CAN call the guarded stock function',
  (select public.fn_staff_on_hand('bbbbbbbb-0000-0000-0000-000000000001')) >= 0);
select testing.check('Staff scope', 'staff CAN complete a sale',
  (select public.rpc_complete_sale(
     jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000004','quantity',1)),
     'CASH') ->> 'sale_number') like 'S-%');

-- Product ownership is captured as the owner, so the supplier-side assertions
-- below never need to read a table the supplier themselves cannot read.
reset role;
select string_agg(product_code, ',') as abc_codes from public.products
 where supplier_id = '11111111-1111-1111-1111-111111111111' \gset
select string_agg(product_code, ',') as xyz_codes from public.products
 where supplier_id = '22222222-2222-2222-2222-222222222222' \gset
select public.fn_money(coalesce(sum(payable_amount), 0)) as abc_payable
  from public.supplier_payables where supplier_id = '11111111-1111-1111-1111-111111111111' \gset

-- ===========================================================================
-- 4. SUPPLIER A  (must never see Supplier B)
-- ===========================================================================
\echo '--- supplier A (ABC Cosmetics) ---'
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'abc_user_id', 'role', 'authenticated')::text, false);

select testing.check('Supplier isolation', 'supplier A sees only their own profile',
  (select name from public.supplier_portal_profile) = 'ABC Cosmetics');
select testing.check('Supplier isolation', 'supplier A sees their own receipts',
  (select count(*) from public.supplier_portal_receipts) > 0);
select testing.check('Supplier isolation', 'EVERY receipt is theirs — none of supplier B''s products appear',
  (select bool_and(r.product_code = any (string_to_array(:'abc_codes', ',')))
     from public.supplier_portal_receipts r));
select testing.check('Supplier isolation', 'supplier A sees their own payable lines',
  (select count(*) from public.supplier_portal_orders) > 0);
select testing.check('Supplier isolation', 'EVERY payable line is for an ABC product',
  (select bool_and(o.product_code = any (string_to_array(:'abc_codes', ',')))
     from public.supplier_portal_orders o));
select testing.check('Supplier isolation', 'the summary payable matches the independently computed figure',
  (select total_payable = :'abc_payable'::numeric from public.supplier_portal_summary));
select testing.check('Supplier isolation', 'supplier A sees statements addressed to them',
  (select bool_and(supplier_name = 'ABC Cosmetics') from public.supplier_portal_statements));

-- supplier must not reach anything else
select testing.eq_int('Supplier isolation', 'LUBELLA SALES are invisible to the supplier',
  (select count(*)::int from public.sales), 0);
select testing.eq_int('Supplier isolation', 'LUBELLA EXPENSES are invisible to the supplier',
  (select count(*)::int from public.expenses), 0);
select testing.expect_error('Supplier isolation', 'the LUBELLA P&L is unreachable for the supplier',
  'select * from public.v_pnl_monthly limit 1');
select testing.expect_error('Supplier isolation', 'the owner P&L report RPC is refused to the supplier',
  'select public.rpc_report_pnl()');
select testing.eq_int('Supplier isolation', 'staff commissions are invisible to the supplier',
  (select count(*)::int from public.v_staff_commissions), 0);
select testing.expect_error('Supplier isolation', 'the statements table is not granted to a supplier',
  'select * from public.supplier_statements limit 1');
select testing.check('Supplier isolation', 'supplier A''s statement totals agree with the payable lines',
  (select coalesce(bool_and(abs(outstanding - public.fn_money(opening_outstanding + total_payable - total_paid)) < 0.01), true)
     from public.supplier_portal_statements));
select testing.eq_int('Supplier isolation', 'customer requests (with phone numbers) are invisible',
  (select count(*)::int from public.customer_requests), 0);
select testing.eq_int('Supplier isolation', 'the base supplier table is owner-only, so it yields nothing',
  (select count(*)::int from public.suppliers), 0);
select testing.check('Supplier isolation', 'the supplier reads their own record through the portal view',
  (select count(*) = 1 from public.supplier_portal_profile));
select testing.expect_error('Supplier isolation', 'owner-only internal notes are unreachable',
  'select * from public.supplier_internal_notes limit 1');
select testing.check('Supplier isolation', 'the supplier portal exposes NO selling price',
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name in
      ('supplier_portal_orders','supplier_portal_receipts','supplier_portal_payments','supplier_portal_summary')
      and column_name in ('selling_price','price','line_total','margin')) = 0);
select testing.expect_error('Supplier isolation', 'supplier cannot read purchase_batches directly',
  'select * from public.purchase_batches limit 1');
select testing.expect_error('Supplier isolation', 'supplier cannot read the owner dashboard',
  'select public.rpc_owner_dashboard()');
select testing.eq_int('Supplier isolation', 'the audit log returns zero rows for a supplier',
  (select count(*)::int from public.audit_logs), 0);
select testing.expect_error('Supplier isolation', 'supplier cannot complete a sale',
  $q$select public.rpc_complete_sale(jsonb_build_array(jsonb_build_object('product_id','bbbbbbbb-0000-0000-0000-000000000001','quantity',1)), 'CASH')$q$);
select testing.eq_int('Supplier isolation', 'staff-only views return zero rows for a supplier',
  (select count(*)::int from public.v_staff_products), 0);
select testing.expect_error('Supplier isolation', 'the guarded stock function refuses a supplier',
  $q$select public.fn_staff_on_hand('bbbbbbbb-0000-0000-0000-000000000001')$q$);
select testing.expect_error('Supplier isolation', 'supplier cannot read cost helpers',
  $q$select public.fn_avg_unit_cost('bbbbbbbb-0000-0000-0000-000000000001')$q$);
select testing.expect_error('Supplier isolation', 'supplier cannot read private settings',
  $q$select public.fn_setting('telegram_bot_token')$q$);
select testing.check('Supplier isolation', 'supplier CAN read their own statements and payments only',
  (select bool_and(supplier_name = 'ABC Cosmetics') from public.supplier_portal_statements)
  and (select count(*) from public.supplier_portal_payments) >= 0);

-- ===========================================================================
-- 5. SUPPLIER B  (mirror: sees the other half, and only that half)
-- ===========================================================================
\echo '--- supplier B (XYZ Beauty) ---'
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'xyz_user_id', 'role', 'authenticated')::text, false);

select testing.check('Supplier isolation', 'supplier B sees their own profile',
  (select name from public.supplier_portal_profile) = 'XYZ Beauty');
select testing.check('Supplier isolation', 'supplier B cannot see supplier A''s receipts',
  (select bool_and(r.product_code = any (string_to_array(:'xyz_codes', ',')))
     from public.supplier_portal_receipts r));
select testing.check('Supplier isolation', 'A and B see disjoint sets of payable lines',
  (select count(*) from public.supplier_portal_orders) > 0
  and (select bool_and(o.product_code = any (string_to_array(:'xyz_codes', ',')))
         from public.supplier_portal_orders o));

-- ===========================================================================
-- 6. OWNER (control: proves the walls come from RLS, not from a broken app)
-- ===========================================================================
\echo '--- owner (control) ---'
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, false);

select testing.check('Owner', 'owner can read purchase batches (cost) via the RPC',
  jsonb_array_length(public.rpc_list_batches() -> 'items') > 0);
select testing.check('Owner', 'the batch listing carries unit cost and margin for the owner',
  (select (item ->> 'unit_cost')::numeric >= 0
     from jsonb_array_elements(public.rpc_list_batches() -> 'items') item limit 1));
select testing.check('Owner', 'the restock listing carries the cost-review workflow',
  jsonb_array_length(public.rpc_list_restocks(true) -> 'items') >= 0);
select testing.check('Owner', 'owner can read supplier payables (via the report RPC)',
  jsonb_array_length(public.rpc_report_supplier_payable() -> 'lines') >= 0);
select testing.check('Owner', 'the payable RPC carries cost-based payable amounts',
  (select bool_and((line ->> 'payable_amount')::numeric >= 0)
     from jsonb_array_elements(public.rpc_report_supplier_payable() -> 'lines') line));
select testing.check('Owner', 'owner sees ALL staff commissions',
  (select count(distinct staff_id) from public.commissions) >= 1);
select testing.check('Owner', 'owner sees all expenses',
  (select count(*) from public.expenses) > 0);
select testing.check('Owner', 'owner sees the inventory valuation (via the report RPC)',
  jsonb_array_length(public.rpc_report_inventory() -> 'items') > 0);
select testing.check('Owner', 'the valuation RPC carries cost and stock value',
  (public.rpc_report_inventory() -> 'totals' ->> 'total_value')::numeric > 0);
select testing.check('Owner', 'owner sees the P&L (via the report RPC)',
  jsonb_array_length(public.rpc_report_pnl() -> 'months') > 0);
select testing.check('Owner', 'owner sees the supplier credit book',
  jsonb_array_length(public.rpc_report_supplier_payable() -> 'suppliers') > 1);
select testing.check('Owner', 'owner can call the guarded stock function',
  (select public.fn_staff_on_hand('bbbbbbbb-0000-0000-0000-000000000001')) >= 0);
select testing.check('Owner', 'owner sees the audit log',
  (select count(*) from public.audit_logs) > 0);
select testing.check('Owner', 'owner can call the API surface listing',
  jsonb_array_length(public.rpc_api_surface() -> 'anon') > 0);
-- Precise rather than arbitrary: exactly four RPCs are reachable anonymously,
-- and they are the four intended ones. Anything else appearing here is a
-- privilege leak, so this is the tripwire for future migrations.
select testing.check('Owner', 'exactly the 4 intended RPCs are callable anonymously',
  (select count(*) from jsonb_array_elements_text(public.rpc_api_surface() -> 'anon') f
    where f like 'rpc!_%' escape '!') = 4);
select testing.check('Owner', 'the anonymously callable RPCs are exactly the public ones',
  (select bool_and(f in ('rpc_public_catalog','rpc_public_filters',
                         'rpc_build_order_message','rpc_submit_customer_request'))
     from jsonb_array_elements_text(public.rpc_api_surface() -> 'anon') f
    where f like 'rpc!_%' escape '!'),
  (select string_agg(f, ', ') from jsonb_array_elements_text(public.rpc_api_surface() -> 'anon') f
    where f like 'rpc!_%' escape '!'));
select testing.check('Owner', 'no costing or secret-reading helper is reachable anonymously',
  not ((public.rpc_api_surface() -> 'anon') ?| array['fn_on_hand','fn_avg_unit_cost','fn_setting',
                                                  'fn_require_owner','fn_require_internal',
                                                  'fn_fifo_consume','fn_create_batch']),
  (public.rpc_api_surface() -> 'anon')::text);
select testing.check('Owner', 'customer_requests is readable so requests can be handled',
  (select count(*) from public.customer_requests) > 0);

-- ===========================================================================
-- 7. Cross-cutting: no write path exists outside the RPCs
-- ===========================================================================
\echo '--- no direct writes ---'
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, false);

select testing.expect_error('No direct writes', 'even the OWNER cannot insert a sale row directly',
  $q$insert into public.sales (sale_number, subtotal, total_amount, payment_method, staff_id)
     values ('HACK-1', 0, 0, 'CASH', auth.uid())$q$);
select testing.expect_error('No direct writes', 'nobody can alter a payable by hand',
  'update public.supplier_payables set outstanding = 0');
select testing.expect_error('No direct writes', 'nobody can delete financial history',
  'delete from public.sales');
select testing.expect_error('No direct writes', 'the audit log cannot be edited',
  'update public.audit_logs set action = ''COVERED_UP''');
select testing.expect_error('No direct writes', 'the audit log cannot be cleared',
  'delete from public.audit_logs');
select testing.expect_error('No direct writes', 'a selling price cannot be changed outside the owner RPC',
  'update public.products set selling_price = 1');

reset role;
