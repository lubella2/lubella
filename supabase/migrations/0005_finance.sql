-- ============================================================================
-- LuBella  |  Migration 0005 — Supplier credit book, commission, expenses, tithe
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Supplier payables. Created ONLY by FIFO allocation, inside the sale
-- transaction. rate_per_unit is the batch cost, never the selling price.
-- ============================================================================
create table if not exists public.supplier_payables (
  id                 uuid        primary key default gen_random_uuid(),
  supplier_id        uuid        not null references public.suppliers(id),
  product_id         uuid        not null references public.products(id),
  purchase_batch_id  uuid        not null references public.purchase_batches(id),
  fifo_allocation_id uuid        references public.fifo_allocations(id),
  sale_id            uuid        references public.sales(id),
  entry_date         date        not null default current_date,
  quantity_sold      int         not null,
  purchase_cost      numeric(14,2) not null,      -- unit cost
  payable_amount     numeric(14,2) not null,
  amount_paid        numeric(14,2) not null default 0,
  outstanding        numeric(14,2) not null default 0,
  status             public.payable_status not null default 'UNPAID',
  is_reversal        boolean     not null default false,
  created_at         timestamptz not null default now(),
  constraint payables_qty_positive check (quantity_sold <> 0),
  constraint payables_outstanding_ok check (outstanding = round(payable_amount - amount_paid, 2))
);

create index if not exists payables_supplier_idx on public.supplier_payables (supplier_id, entry_date desc);
create index if not exists payables_batch_idx    on public.supplier_payables (purchase_batch_id);
create index if not exists payables_open_idx     on public.supplier_payables (supplier_id) where status <> 'PAID';
create index if not exists payables_date_idx     on public.supplier_payables (entry_date desc);

-- ---------------------------------------------------------------------------
-- Supplier payments. NOTE: a supplier payment settles a liability that was
-- already recognised in COGS at the moment of sale — it is NOT an operating
-- expense and must never appear in the P&L (spec §24, §60).
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_payments (
  id             uuid        primary key default gen_random_uuid(),
  payment_number text        unique not null,
  supplier_id    uuid        not null references public.suppliers(id),
  amount         numeric(14,2) not null,
  payment_method public.payment_method not null,
  payment_date   date        not null default current_date,
  reference      text,
  notes          text,
  created_by     uuid        not null references public.app_users(id),
  voided_at      timestamptz,
  voided_by      uuid        references public.app_users(id),
  void_reason    text,
  created_at     timestamptz not null default now(),
  constraint supplier_payments_positive check (amount > 0)
);

create index if not exists supp_pay_supplier_idx on public.supplier_payments (supplier_id, payment_date desc);

-- Which payable lines a payment settled (oldest-outstanding first).
create table if not exists public.supplier_payment_allocations (
  id             uuid        primary key default gen_random_uuid(),
  payment_id     uuid        not null references public.supplier_payments(id) on delete cascade,
  payable_id     uuid        not null references public.supplier_payables(id),
  amount         numeric(14,2) not null,
  created_at     timestamptz not null default now(),
  constraint supp_pay_alloc_positive check (amount > 0)
);

create index if not exists supp_pay_alloc_payable_idx on public.supplier_payment_allocations (payable_id);

-- ---------------------------------------------------------------------------
-- Monthly supplier statements. Totals are RECOMPUTED from the transaction
-- records by rpc_generate_supplier_statement(); nothing is typed by hand.
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_statements (
  id                  uuid        primary key default gen_random_uuid(),
  statement_number    text        unique not null,
  supplier_id         uuid        not null references public.suppliers(id),
  period_month        date        not null,          -- always the 1st of the month
  opening_outstanding numeric(14,2) not null default 0,
  units_sold          int         not null default 0,
  total_payable       numeric(14,2) not null default 0,
  total_paid          numeric(14,2) not null default 0,
  outstanding         numeric(14,2) not null default 0,
  generated_by        uuid        references public.app_users(id),
  generated_at        timestamptz not null default now(),
  unique (supplier_id, period_month),
  constraint statements_month_first check (period_month = date_trunc('month', period_month)::date),
  constraint statements_outstanding_ok check (outstanding = round(opening_outstanding + total_payable - total_paid, 2))
);

create index if not exists statements_supplier_idx on public.supplier_statements (supplier_id, period_month desc);

-- ---------------------------------------------------------------------------
-- Commissions. Rate comes from app_users.commission_rate (staff 3%, owner 0%),
-- applied to the FINAL, post-discount amount. Reversal rows are appended; an
-- original EARNED row is never deleted (spec §36).
-- ---------------------------------------------------------------------------
create table if not exists public.commissions (
  id             uuid        primary key default gen_random_uuid(),
  staff_id       uuid        not null references public.app_users(id),
  sale_id        uuid        references public.sales(id),
  return_id      uuid        references public.returns(id),
  amount         numeric(14,2) not null,        -- signed: negative for reversals
  rate           numeric(6,4) not null,
  type           public.commission_type not null,
  sale_date      date        not null default current_date,
  note           text,
  created_by     uuid        references public.app_users(id),
  created_at     timestamptz not null default now()
);

create index if not exists commissions_staff_idx on public.commissions (staff_id, sale_date desc);
create index if not exists commissions_sale_idx  on public.commissions (sale_id);

create table if not exists public.commission_payments (
  id             uuid        primary key default gen_random_uuid(),
  payment_number text        unique not null,
  staff_id       uuid        not null references public.app_users(id),
  period_start   date        not null,
  period_end     date        not null,
  amount         numeric(14,2) not null,
  payment_method public.payment_method not null,
  payment_date   date        not null default current_date,
  reference      text,
  notes          text,
  created_by     uuid        references public.app_users(id),
  created_at     timestamptz not null default now(),
  constraint commission_payments_positive check (amount > 0)
);

-- ---------------------------------------------------------------------------
-- Expenses (owner-only)
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id             uuid        primary key default gen_random_uuid(),
  expense_number text        unique not null,
  category       public.expense_category not null,
  amount         numeric(14,2) not null,
  payment_method public.payment_method not null,
  expense_date   date        not null default current_date,
  description    text,
  receipt_url    text,
  created_by     uuid        not null references public.app_users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint expenses_amount_positive check (amount > 0)
);

create index if not exists expenses_date_idx on public.expenses (expense_date desc);
create index if not exists expenses_cat_idx  on public.expenses (category, expense_date desc);

drop trigger if exists trg_expenses_touch on public.expenses;
create trigger trg_expenses_touch before update on public.expenses
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Tithe = 10% of NET PROFIT, monthly, never negative (spec §41)
-- ---------------------------------------------------------------------------
create table if not exists public.tithe_records (
  id             uuid        primary key default gen_random_uuid(),
  period_month   date        not null unique,
  net_profit     numeric(14,2) not null,
  tithe_rate     numeric(6,4) not null default 0.10,
  tithe_amount   numeric(14,2) not null default 0,
  status         public.record_status not null default 'DUE',
  paid_date      date,
  payment_method public.payment_method,
  reference      text,
  notes          text,
  created_by     uuid        references public.app_users(id),
  created_at     timestamptz not null default now(),
  constraint tithe_month_first check (period_month = date_trunc('month', period_month)::date),
  constraint tithe_nonneg check (tithe_amount >= 0)
);

-- ---------------------------------------------------------------------------
-- Monthly financial close (spec §54). Once a month is CLOSED, the RPCs refuse
-- to touch its transactions; corrections must go through an audited adjustment.
-- ---------------------------------------------------------------------------
create table if not exists public.period_closes (
  id            uuid        primary key default gen_random_uuid(),
  period_month  date        not null unique,
  status        public.period_status not null default 'OPEN',
  net_sales     numeric(14,2),
  cogs          numeric(14,2),
  gross_profit  numeric(14,2),
  expenses      numeric(14,2),
  commission    numeric(14,2),
  net_profit    numeric(14,2),
  closed_by     uuid        references public.app_users(id),
  closed_at     timestamptz,
  reopened_at   timestamptz,
  reopened_by   uuid        references public.app_users(id),
  notes         text,
  created_at    timestamptz not null default now(),
  constraint closes_month_first check (period_month = date_trunc('month', period_month)::date)
);
