-- ============================================================================
-- LuBella  |  Migration 0002 — Core entities
-- ============================================================================
-- app_users, categories, suppliers, supplier_users, products.
-- NOTE: products deliberately has NO purchase-cost column. Cost is a property
-- of a received batch (purchase_batches), which is what makes the "staff can
-- never see cost" rule enforceable at the table level rather than the UI level.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- app_users mirrors auth.users 1:1 and is the authoritative role record.
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  id            uuid        primary key,          -- = auth.users.id
  email         text        unique not null,
  full_name     text        not null,
  phone         text,
  role          public.user_role not null,
  active        boolean     not null default true,
  commission_rate numeric(6,4) not null default 0.03,
  note          text,
  last_login_at timestamptz,
  created_by    uuid        references public.app_users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint app_users_commission_range check (commission_rate >= 0 and commission_rate <= 1)
);

create index if not exists app_users_role_idx on public.app_users (role) where active;

drop trigger if exists trg_app_users_touch on public.app_users;
create trigger trg_app_users_touch before update on public.app_users
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  slug        text        not null unique,
  description text,
  image_url   text,
  sort_order  int         not null default 0,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_categories_touch on public.categories;
create trigger trg_categories_touch before update on public.categories
  for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create table if not exists public.suppliers (
  id            uuid        primary key default gen_random_uuid(),
  supplier_code text        unique not null,
  name          text        not null,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  tin_number    text,
  payment_terms text        default 'Monthly settlement on units sold',
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists suppliers_active_idx on public.suppliers (active);

drop trigger if exists trg_suppliers_touch on public.suppliers;
create trigger trg_suppliers_touch before update on public.suppliers
  for each row execute function public.fn_touch_updated_at();

-- Owner-only annotations. Kept in their own table so that no view exposed to a
-- supplier can accidentally include it.
create table if not exists public.supplier_internal_notes (
  id          uuid        primary key default gen_random_uuid(),
  supplier_id uuid        not null references public.suppliers(id) on delete cascade,
  note        text        not null,
  created_by  uuid        references public.app_users(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- supplier_users — links a Supabase Auth user to exactly one supplier
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_users (
  id          uuid        primary key default gen_random_uuid(),
  supplier_id uuid        not null references public.suppliers(id) on delete cascade,
  user_id     uuid        not null references public.app_users(id) on delete cascade,
  status      public.supplier_user_status not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  unique (supplier_id, user_id)
);

create index if not exists supplier_users_user_idx on public.supplier_users (user_id);
create index if not exists supplier_users_supplier_idx on public.supplier_users (supplier_id);

-- ---------------------------------------------------------------------------
-- Products  (selling side only — no cost column, by design)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id            uuid        primary key default gen_random_uuid(),
  product_code  text        unique not null,
  name          text        not null,
  category_id   uuid        references public.categories(id),
  brand         text,
  supplier_id   uuid        references public.suppliers(id),
  image_url     text,
  selling_price numeric(14,2) not null,
  minimum_stock int         not null default 5,
  expiry_date   date,
  description   text,
  keywords      text,
  featured      boolean     not null default false,
  active        boolean     not null default true,
  is_public     boolean     not null default true,   -- show in customer catalog
  created_by    uuid        references public.app_users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_price_positive  check (selling_price >= 0),
  constraint products_min_stock_nn    check (minimum_stock >= 0)
);

create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_supplier_idx on public.products (supplier_id);
create index if not exists products_active_idx   on public.products (active) where active;
create index if not exists products_search_idx   on public.products
  using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(keywords,'')));

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.fn_touch_updated_at();

-- Selling-price history: a price change is an auditable financial event.
create table if not exists public.product_price_history (
  id            uuid        primary key default gen_random_uuid(),
  product_id    uuid        not null references public.products(id) on delete cascade,
  old_price     numeric(14,2),
  new_price     numeric(14,2) not null,
  reason        text,
  changed_by    uuid        references public.app_users(id),
  created_at    timestamptz not null default now()
);

create or replace function public.fn_product_price_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.selling_price is distinct from old.selling_price then
    insert into public.product_price_history (product_id, old_price, new_price, changed_by)
    values (new.id, old.selling_price, new.selling_price, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_products_price_history on public.products;
create trigger trg_products_price_history after update on public.products
  for each row execute function public.fn_product_price_history();
