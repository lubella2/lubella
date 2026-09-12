-- ============================================================================
-- LuBella  |  Migration 0003 — Inventory ledger, batches, stock periods
-- ============================================================================
-- Purchase cost lives HERE, on purchase_batches.unit_cost, and nowhere else.
-- On-hand stock is always derived from the append-only stock_movements ledger,
-- so it can never drift out of sync with reality.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Purchase batches — one row per received shipment, FIFO-ordered by received_at
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_batches (
  id                  uuid        primary key default gen_random_uuid(),
  batch_number        text        unique not null,
  product_id          uuid        not null references public.products(id),
  supplier_id         uuid        not null references public.suppliers(id),
  unit_cost           numeric(14,2) not null default 0,   -- 0 = awaiting owner's cost entry
  cost_status         public.cost_status not null default 'PENDING',
  quantity_received   int         not null,
  quantity_remaining  int         not null,
  quantity_sold       int         not null default 0,
  expiry_date         date,
  received_date       date        not null default current_date,
  received_by         uuid        references public.app_users(id),
  notes               text,
  status              public.batch_status not null default 'OPEN',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint batches_qty_positive   check (quantity_received > 0),
  constraint batches_remaining_ok   check (quantity_remaining >= 0 and quantity_remaining <= quantity_received),
  constraint batches_sold_ok        check (quantity_sold >= 0 and quantity_sold <= quantity_received),
  constraint batches_cost_nonneg    check (unit_cost >= 0)
);

create index if not exists batches_fifo_idx     on public.purchase_batches (product_id, received_date, created_at);
create index if not exists batches_supplier_idx on public.purchase_batches (supplier_id);
create index if not exists batches_open_idx     on public.purchase_batches (product_id) where quantity_remaining > 0;
create index if not exists batches_pending_idx  on public.purchase_batches (cost_status) where cost_status = 'PENDING';

drop trigger if exists trg_batches_touch on public.purchase_batches;
create trigger trg_batches_touch before update on public.purchase_batches
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Purchase cost history — every change to a batch cost is preserved
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_cost_history (
  id           uuid        primary key default gen_random_uuid(),
  batch_id     uuid        not null references public.purchase_batches(id) on delete cascade,
  product_id   uuid        not null references public.products(id),
  supplier_id  uuid        not null references public.suppliers(id),
  old_cost     numeric(14,2),
  new_cost     numeric(14,2) not null,
  reason       text,
  changed_by   uuid        references public.app_users(id),
  created_at   timestamptz not null default now()
);

create index if not exists cost_history_batch_idx on public.purchase_cost_history (batch_id);

-- ---------------------------------------------------------------------------
-- Restocks — the receiving document. Created by staff (no cost) and later
-- priced by the owner. One restock -> one batch -> one RESTOCK movement.
-- ---------------------------------------------------------------------------
create table if not exists public.restocks (
  id                uuid        primary key default gen_random_uuid(),
  restock_number    text        unique not null,
  batch_id          uuid        references public.purchase_batches(id),
  product_id        uuid        not null references public.products(id),
  supplier_id       uuid        not null references public.suppliers(id),
  quantity          int         not null,
  unit_cost         numeric(14,2),            -- null until the owner records it
  received_date     date        not null default current_date,
  expiry_date       date,
  supplier_invoice  text,
  notes             text,
  cost_pending      boolean     not null default true,
  cost_flagged      boolean     not null default false,  -- owner warned: differs from last known cost
  previous_unit_cost numeric(14,2),
  status            text        not null default 'RECEIVED',
  received_by       uuid        references public.app_users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint restocks_qty_positive check (quantity > 0)
);

create index if not exists restocks_product_idx  on public.restocks (product_id, received_date desc);
create index if not exists restocks_pending_idx  on public.restocks (cost_pending) where cost_pending;

drop trigger if exists trg_restocks_touch on public.restocks;
create trigger trg_restocks_touch before update on public.restocks
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Biweekly stock periods (spec §29). e.g. 1–14 and 15–end-of-month.
-- Declared before stock_movements because the ledger references the period it
-- belongs to (which is what makes per-period beginning stock reconstructable).
-- ---------------------------------------------------------------------------
create table if not exists public.stock_periods (
  id             uuid        primary key default gen_random_uuid(),
  label          text        not null,
  period_start   date        not null,
  period_end     date        not null,
  status         public.period_status not null default 'OPEN',
  closed_at      timestamptz,
  closed_by      uuid        references public.app_users(id),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint periods_range check (period_end >= period_start)
);

create unique index if not exists periods_unique_range on public.stock_periods (period_start, period_end);

drop trigger if exists trg_periods_touch on public.stock_periods;
create trigger trg_periods_touch before update on public.stock_periods
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Stock movements — the append-only ledger. Never updated, never deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id             uuid        primary key default gen_random_uuid(),
  product_id     uuid        not null references public.products(id),
  movement_type  public.movement_type not null,
  quantity       int         not null,      -- signed: + in, - out
  unit_cost      numeric(14,2),             -- cost basis where meaningful (never exposed to staff)
  reference_type text,                      -- 'sale' | 'return' | 'restock' | 'stock_count' | ...
  reference_id   uuid,
  batch_id       uuid        references public.purchase_batches(id),
  stock_period_id uuid       references public.stock_periods(id),
  reason         text,
  created_by     uuid        references public.app_users(id),
  created_at     timestamptz not null default now()
);

create index if not exists movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists movements_type_idx    on public.stock_movements (movement_type, created_at desc);
create index if not exists movements_ref_idx     on public.stock_movements (reference_type, reference_id);
create index if not exists movements_period_idx  on public.stock_movements (stock_period_id);

-- ---------------------------------------------------------------------------
-- Physical stock counts. expected vs counted -> variance -> owner-confirmed
-- ADJUSTMENT movements, and the next period's BEGINNING_STOCK.
-- ---------------------------------------------------------------------------
create table if not exists public.stock_counts (
  id                 uuid        primary key default gen_random_uuid(),
  stock_period_id    uuid        not null references public.stock_periods(id) on delete cascade,
  product_id         uuid        not null references public.products(id),
  expected_quantity  int         not null,
  counted_quantity   int         not null,
  variance           int         generated always as (counted_quantity - expected_quantity) stored,
  unit_cost          numeric(14,2),          -- owner-only valuation
  variance_value     numeric(14,2),          -- owner-only
  status             text        not null default 'PENDING',  -- PENDING | CONFIRMED
  notes              text,
  counted_by         uuid        references public.app_users(id),
  confirmed_by       uuid        references public.app_users(id),
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (stock_period_id, product_id),
  constraint counts_nonneg check (counted_quantity >= 0 and expected_quantity >= 0)
);

create index if not exists counts_period_idx  on public.stock_counts (stock_period_id);
create index if not exists counts_pending_idx on public.stock_counts (stock_period_id) where status = 'PENDING';

drop trigger if exists trg_counts_touch on public.stock_counts;
create trigger trg_counts_touch before update on public.stock_counts
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Derived on-hand quantity. SECURITY DEFINER so that staff may call it without
-- being granted SELECT on stock_movements' costing columns.
-- ---------------------------------------------------------------------------
create or replace function public.fn_on_hand(p_product_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(quantity), 0)::int
  from public.stock_movements
  where product_id = p_product_id;
$$;

-- Weighted-average cost of the units currently on hand (owner-only information).
create or replace function public.fn_avg_unit_cost(p_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    round(sum(b.quantity_remaining * b.unit_cost) / nullif(sum(b.quantity_remaining), 0), 2),
    0)
  from public.purchase_batches b
  where b.product_id = p_product_id and b.quantity_remaining > 0;
$$;
