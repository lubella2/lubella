-- ============================================================================
-- LuBella  |  Test fixture
-- ============================================================================
-- Builds the exact scenarios named in the specification:
--   §22 supplier credit model (20 lipstick / 10 cream / 5 perfume)
--   §23 FIFO (batch 1: 20 @ 300, batch 2: 20 @ 350, sale of 25)
--   §34/§35 discount + 3% commission (2,000 → discount 200 → 1,800 → 54)
--   §36 full and partial return reversals
--   §40/§41 P&L and tithe
-- Requires the superuser connection (seed data is inserted directly).
-- ============================================================================

truncate table
  public.audit_logs, public.commissions, public.commission_payments,
  public.fifo_allocations, public.supplier_payment_allocations, public.supplier_payments,
  public.supplier_payables, public.return_items, public.returns, public.sale_items,
  public.sales, public.stock_movements, public.stock_counts, public.expenses,
  public.tithe_records, public.period_closes, public.customer_requests,
  public.request_rate_limit, public.backup_runs, public.purchase_cost_history,
  public.restocks, public.purchase_batches, public.product_price_history,
  public.product_price_history, public.stock_periods, public.supplier_statements,
  public.supplier_internal_notes, public.products, public.categories,
  public.supplier_users, public.suppliers, public.app_users, public.number_sequences,
  public.settings
restart identity cascade;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, is_public) values
  ('whatsapp_number', '"+251911223344"'::jsonb, true),
  ('telegram_username', '"lubella_shop"'::jsonb, true),
  ('telegram_bot_username', '"lubella_orders_bot"'::jsonb, true),
  ('telegram_bot_token', '"SECRET-TOKEN-DO-NOT-LEAK"'::jsonb, false),
  ('expiry_warning_days', '30'::jsonb, true),
  ('tithe_rate', '0.10'::jsonb, true);

-- ---------------------------------------------------------------------------
-- Accounts. Logins are created through the auth shim, then registered.
-- ---------------------------------------------------------------------------
select auth.create_user('owner@lubella.shop', 'owner-pass') as owner_auth \gset
select auth.create_user('sara@lubella.shop',  'sara-pass')  as sara_auth  \gset
select auth.create_user('abc@supplier.et',    'abc-pass')   as abc_auth   \gset
select auth.create_user('xyz@supplier.et',    'xyz-pass')   as xyz_auth   \gset
select auth.create_user('hana@lubella.shop',  'hana-pass')  as hana_auth  \gset

-- Bootstrap: the first registered account must be the owner.
insert into public.app_users (id, email, full_name, role, commission_rate) values
  (:'owner_auth', 'owner@lubella.shop', 'LuBella Owner', 'OWNER', 0.0),
  (:'sara_auth',  'sara@lubella.shop',  'Sara Bekele',   'STAFF', 0.03),
  (:'hana_auth',  'hana@lubella.shop',  'Hana Girma',    'STAFF', 0.03),
  (:'abc_auth',   'abc@supplier.et',    'ABC Cosmetics', 'SUPPLIER', 0.0),
  (:'xyz_auth',   'xyz@supplier.et',    'XYZ Beauty',    'SUPPLIER', 0.0);

insert into public.suppliers (id, supplier_code, name, phone, contact_name) values
  ('11111111-1111-1111-1111-111111111111', 'SUP-0001', 'ABC Cosmetics', '0911223344', 'Alemu'),
  ('22222222-2222-2222-2222-222222222222', 'SUP-0002', 'XYZ Beauty',    '0922334455', 'Zewditu');

insert into public.supplier_users (supplier_id, user_id, status) values
  ('11111111-1111-1111-1111-111111111111', :'abc_auth', 'ACTIVE'),
  ('22222222-2222-2222-2222-222222222222', :'xyz_auth', 'ACTIVE');

insert into public.categories (id, name, slug, sort_order) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Lips',        'lips',        1),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Fragrance',   'fragrance',   2),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Accessories', 'accessories', 3),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Skincare',    'skincare',    4);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
insert into public.products (id, product_code, name, category_id, brand, supplier_id,
                             selling_price, minimum_stock, expiry_date, description, featured) values
  -- §23 FIFO scenario
  ('bbbbbbbb-0000-0000-0000-000000000001', 'P-0001', 'Maybelline Lipstick', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Maybelline', '11111111-1111-1111-1111-111111111111', 500.00, 5, null, 'Matte long-wear lipstick', true),
  -- §22 credit-model scenario
  ('bbbbbbbb-0000-0000-0000-000000000002', 'P-0002', 'Face Cream', 'aaaaaaaa-0000-0000-0000-000000000004',
   'Nivea', '11111111-1111-1111-1111-111111111111', 900.00, 3, null, 'Hydrating day cream', false),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'P-0003', 'Perfume X', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Jadore', '22222222-2222-2222-2222-222222222222', 1500.00, 2, null, 'Floral eau de parfum', true),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'P-0004', 'Gold Earrings', 'aaaaaaaa-0000-0000-0000-000000000003',
   'LuBella', '22222222-2222-2222-2222-222222222222', 250.00, 2, null, 'Gold-plated hoop earrings', false),
  -- expiry scenario
  ('bbbbbbbb-0000-0000-0000-000000000005', 'P-0005', 'Expired Mascara', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Essence', '11111111-1111-1111-1111-111111111111', 400.00, 2, current_date - 5, 'Volumising mascara', false),
  -- demand scenario: a product we do not stock at all
  ('bbbbbbbb-0000-0000-0000-000000000006', 'P-0006', 'Foundation', 'aaaaaaaa-0000-0000-0000-000000000004',
   'Maybelline', '11111111-1111-1111-1111-111111111111', 850.00, 2, null, 'Full-coverage foundation', false);

-- ---------------------------------------------------------------------------
-- Batches
--   §23: Lipstick batch1 20 @ 300, batch2 20 @ 350
--   §22: Cream 10 @ 500, Perfume 5 @ 1000  (supplier-provided, on credit)
-- ---------------------------------------------------------------------------
insert into public.purchase_batches (id, batch_number, product_id, supplier_id, unit_cost,
                                     cost_status, quantity_received, quantity_remaining,
                                     received_date, notes) values
  ('cccccccc-0000-0000-0000-000000000001', 'B-000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 300.00, 'RECORDED', 20, 20, current_date - 30, 'Batch 1'),
  ('cccccccc-0000-0000-0000-000000000002', 'B-000002', 'bbbbbbbb-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 350.00, 'RECORDED', 20, 20, current_date - 10, 'Batch 2'),
  ('cccccccc-0000-0000-0000-000000000003', 'B-000003', 'bbbbbbbb-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 500.00, 'RECORDED', 10, 10, current_date - 20, 'Cream'),
  ('cccccccc-0000-0000-0000-000000000004', 'B-000004', 'bbbbbbbb-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222', 1000.00, 'RECORDED', 5, 5, current_date - 15, 'Perfume'),
  ('cccccccc-0000-0000-0000-000000000005', 'B-000005', 'bbbbbbbb-0000-0000-0000-000000000004',
   '22222222-2222-2222-2222-222222222222', 100.00, 'RECORDED', 10, 10, current_date - 15, 'Earrings'),
  ('cccccccc-0000-0000-0000-000000000006', 'B-000006', 'bbbbbbbb-0000-0000-0000-000000000005',
   '11111111-1111-1111-1111-111111111111', 200.00, 'RECORDED', 6, 6, current_date - 100, 'Mascara (already expired)'),
  -- a shipment received WITHOUT a cost, as staff would create it
  ('cccccccc-0000-0000-0000-000000000007', 'B-000007', 'bbbbbbbb-0000-0000-0000-000000000006',
   '11111111-1111-1111-1111-111111111111', 0.00, 'PENDING', 4, 4, current_date - 3, 'Foundation, cost not yet recorded');

-- Opening stock ledger entries (BEGINNING_STOCK = the one-off opening import)
insert into public.stock_movements (product_id, movement_type, quantity, unit_cost, reference_type, batch_id, reason)
select b.product_id, 'BEGINNING_STOCK', b.quantity_received, b.unit_cost, 'seed', b.id, 'Opening stock'
from public.purchase_batches b;

-- ---------------------------------------------------------------------------
-- A prior-month expense + an earlier month of sales, so P&L and tithe have
-- something to chew on beyond the current month.
-- ---------------------------------------------------------------------------
insert into public.expenses (expense_number, category, amount, payment_method, expense_date, description, created_by)
values (public.fn_next_number('EXP', 6), 'RENT', 15000.00, 'BANK',
        date_trunc('month', current_date)::date, 'Shop rent', :'owner_auth');

-- ---------------------------------------------------------------------------
-- Keep the document sequences ahead of the numbers seeded above, otherwise the
-- next generated batch/product/expense number would collide with a fixture row.
-- The seed inserts B-000001…B-000007, P-0001…P-0006 and one expense number.
-- ---------------------------------------------------------------------------
insert into public.number_sequences (prefix, last_value) values
  ('B',   (select count(*) from public.purchase_batches)),
  ('P',   (select count(*) from public.products)),
  ('EXP', 1),
  ('S',   (select count(*) from public.sales)),
  ('RST', (select count(*) from public.restocks)),
  ('CR',  (select count(*) from public.customer_requests))
on conflict (prefix) do update set last_value = greatest(public.number_sequences.last_value, excluded.last_value);
