-- ============================================================================
-- LuBella  |  Migration 0004 — Sales, FIFO, returns
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id               uuid        primary key default gen_random_uuid(),
  sale_number      text        unique not null,
  sale_date        date        not null default current_date,
  subtotal         numeric(14,2) not null,
  discount_amount  numeric(14,2) not null default 0,
  discount_percent numeric(6,2)  not null default 0,
  tax_amount       numeric(14,2) not null default 0,
  total_amount     numeric(14,2) not null,        -- final amount, after discount
  payment_method   public.payment_method not null,
  payment_reference text,
  amount_tendered  numeric(14,2),
  change_given     numeric(14,2),
  staff_id         uuid        not null references public.app_users(id),
  status           public.sale_status not null default 'COMPLETED',
  returned_amount  numeric(14,2) not null default 0,
  cogs_amount      numeric(14,2) not null default 0,   -- owner-only
  gross_profit     numeric(14,2) not null default 0,   -- owner-only
  voided_at        timestamptz,
  voided_by        uuid        references public.app_users(id),
  void_reason      text,
  notes            text,
  -- Idempotency key supplied by the POS. If a request is retried (flaky mobile
  -- network) the second attempt returns the first sale instead of double-selling.
  client_ref       text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sales_amounts_ok check (
    subtotal >= 0 and discount_amount >= 0 and total_amount >= 0
    and discount_amount <= subtotal and returned_amount >= 0
  ),
  constraint sales_discount_pct check (discount_percent >= 0 and discount_percent <= 100)
);

create index if not exists sales_date_idx    on public.sales (sale_date desc);
create index if not exists sales_staff_idx   on public.sales (staff_id, sale_date desc);
create index if not exists sales_status_idx  on public.sales (status);
create index if not exists sales_created_idx on public.sales (created_at desc);

drop trigger if exists trg_sales_touch on public.sales;
create trigger trg_sales_touch before update on public.sales
  for each row execute function public.fn_touch_updated_at();

create table if not exists public.sale_items (
  id               uuid        primary key default gen_random_uuid(),
  sale_id          uuid        not null references public.sales(id) on delete restrict,
  product_id       uuid        not null references public.products(id),
  quantity         int         not null,
  unit_price       numeric(14,2) not null,
  line_subtotal    numeric(14,2) not null,
  line_discount    numeric(14,2) not null default 0,
  line_total       numeric(14,2) not null,      -- after this line's share of the discount
  unit_cogs        numeric(14,2) not null default 0,   -- weighted FIFO average for this line
  line_cogs        numeric(14,2) not null default 0,
  returned_qty     int         not null default 0,
  -- Running total of what has been given back on this line (returns + voids).
  -- Refunds are computed against the REMAINING value so that per-unit rounding
  -- can never let the refunds on a line exceed what the customer was charged.
  refunded_amount  numeric(14,2) not null default 0,
  created_at       timestamptz not null default now(),
  constraint sale_items_qty_positive check (quantity > 0),
  constraint sale_items_returned_ok  check (returned_qty >= 0 and returned_qty <= quantity),
  constraint sale_items_refund_ok    check (refunded_amount >= 0 and refunded_amount <= line_total + 0.01)
);

create index if not exists sale_items_sale_idx    on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

-- ---------------------------------------------------------------------------
-- FIFO allocations — the bridge between a sold unit and the exact batch (and
-- therefore the exact supplier and exact cost) it came from. Supplier payables
-- are built from THESE rows, which is why payable is never derived from the
-- selling price.
-- ---------------------------------------------------------------------------
create table if not exists public.fifo_allocations (
  id                uuid        primary key default gen_random_uuid(),
  batch_id          uuid        not null references public.purchase_batches(id),
  product_id        uuid        not null references public.products(id),
  supplier_id       uuid        not null references public.suppliers(id),
  sale_id           uuid        references public.sales(id),
  sale_item_id      uuid        references public.sale_items(id),
  quantity          int         not null,
  unit_cost         numeric(14,2) not null,
  total_cost        numeric(14,2) not null,
  direction         text        not null default 'OUT',   -- OUT = sale, IN = return/void reversal
  reversed_by_return_id uuid,
  created_at        timestamptz not null default now(),
  constraint fifo_alloc_qty_positive check (quantity > 0)
);

create index if not exists fifo_batch_idx  on public.fifo_allocations (batch_id);
create index if not exists fifo_sale_idx   on public.fifo_allocations (sale_id);
create index if not exists fifo_supplier_idx on public.fifo_allocations (supplier_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Returns (owner-only per spec §37) and their reversal lines
-- ---------------------------------------------------------------------------
create table if not exists public.returns (
  id               uuid        primary key default gen_random_uuid(),
  return_number    text        unique not null,
  sale_id          uuid        not null references public.sales(id),
  return_date      date        not null default current_date,
  return_type      public.return_type not null,
  return_amount    numeric(14,2) not null,
  cogs_reversed    numeric(14,2) not null default 0,   -- owner-only
  restock_decision text        not null default 'RESTOCK',  -- RESTOCK | DAMAGE
  reason           text,
  processed_by     uuid        not null references public.app_users(id),
  created_at       timestamptz not null default now(),
  constraint returns_amount_positive check (return_amount > 0)
);

create index if not exists returns_sale_idx on public.returns (sale_id);
create index if not exists returns_date_idx on public.returns (return_date desc);

create table if not exists public.return_items (
  id              uuid        primary key default gen_random_uuid(),
  return_id       uuid        not null references public.returns(id) on delete cascade,
  sale_item_id    uuid        not null references public.sale_items(id),
  product_id      uuid        not null references public.products(id),
  quantity        int         not null,
  unit_price      numeric(14,2) not null,
  refund_amount   numeric(14,2) not null,
  unit_cogs       numeric(14,2) not null default 0,
  cogs_reversed   numeric(14,2) not null default 0,
  created_at      timestamptz not null default now(),
  constraint return_items_qty_positive check (quantity > 0)
);

create index if not exists return_items_return_idx on public.return_items (return_id);
