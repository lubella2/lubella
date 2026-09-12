-- ============================================================================
-- LuBella  |  Migration 0006 — Customer requests & demand
-- ============================================================================
-- Customers have no account. They may submit a request through an RPC that is
-- open to `anon`, which is the ONLY write path available to the public.
-- Reading requests back is restricted: they contain phone numbers.
-- ============================================================================

create table if not exists public.customer_requests (
  id                     uuid        primary key default gen_random_uuid(),
  request_number         text        unique not null,
  customer_name          text,
  customer_phone         text,
  product_id             uuid        references public.products(id),
  requested_product_name text        not null,
  quantity               int         not null default 1,
  message                text,
  photo_url              text,
  source                 public.request_source not null default 'WEBSITE',
  status                 public.request_status not null default 'NEW',
  -- demand analytics
  was_unavailable        boolean     not null default false,
  category_id            uuid        references public.categories(id),
  -- operational trail
  handled_by             uuid        references public.app_users(id),
  owner_note             text,
  status_history         jsonb       not null default '[]'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint requests_qty_positive check (quantity > 0)
);

create index if not exists requests_status_idx   on public.customer_requests (status, created_at desc);
create index if not exists requests_product_idx  on public.customer_requests (product_id, created_at desc);
create index if not exists requests_phone_idx    on public.customer_requests (customer_phone);
create index if not exists requests_created_idx  on public.customer_requests (created_at desc);
create index if not exists requests_demand_idx   on public.customer_requests (requested_product_name, created_at desc);

drop trigger if exists trg_requests_touch on public.customer_requests;
create trigger trg_requests_touch before update on public.customer_requests
  for each row execute function public.fn_touch_updated_at();

-- Status transitions are appended to the row's own history so the funnel is
-- reconstructable without joining anything.
create or replace function public.fn_request_status_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    new.status_history := coalesce(old.status_history, '[]'::jsonb)
      || jsonb_build_object(
           'from', old.status, 'to', new.status,
           'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
           'by', auth.uid()
         );
    new.handled_by := coalesce(auth.uid(), new.handled_by);
  end if;
  return new;
end $$;

drop trigger if exists trg_requests_history on public.customer_requests;
create trigger trg_requests_history before update on public.customer_requests
  for each row execute function public.fn_request_status_history();

-- Rate limiting for the public (anon) request endpoint: a light guard so the
-- catalog cannot be spammed through the open RPC.
create table if not exists public.request_rate_limit (
  id          bigserial   primary key,
  phone_hash  text        not null,
  created_at  timestamptz not null default now()
);
create index if not exists request_rate_idx on public.request_rate_limit (phone_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Backup runs — surfaced to the Owner as a backup status card (spec §58)
-- ---------------------------------------------------------------------------
create table if not exists public.backup_runs (
  id            uuid        primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text        not null default 'RUNNING',   -- RUNNING | SUCCESS | FAILED
  backup_type   text        not null default 'WEEKLY_PG_DUMP',
  size_bytes    bigint,
  table_count   int,
  row_count     bigint,
  storage_files int,
  location      text,
  notes         text
);

create index if not exists backup_runs_idx on public.backup_runs (started_at desc);
