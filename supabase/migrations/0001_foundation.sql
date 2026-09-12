-- ============================================================================
-- LuBella Cosmetics & Accessories  |  Migration 0001 — Foundation
-- ============================================================================
-- Enums, generic triggers, document numbering, and the settings registry.
-- Target: PostgreSQL 15+ (Supabase runs 17).
-- ============================================================================

-- gen_random_uuid() is built in from PG13; pgcrypto is only used by the dev shim.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerated types — the vocabulary of the whole business
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('OWNER','STAFF','SUPPLIER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.movement_type as enum
    ('BEGINNING_STOCK','RESTOCK','SALE','RETURN','DAMAGE','EXPIRED','ADJUSTMENT','VOID_REVERSAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('CASH','BANK','TELEBIRR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sale_status as enum ('COMPLETED','PARTIALLY_RETURNED','RETURNED','VOIDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.batch_status as enum ('OPEN','DEPLETED','CLOSED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cost_status as enum ('PENDING','RECORDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payable_status as enum ('UNPAID','PARTIAL','PAID');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.commission_type as enum ('EARNED','RETURN_REVERSAL','VOID_REVERSAL','ADJUSTMENT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.return_type as enum ('FULL','PARTIAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.expense_category as enum
    ('RENT','ELECTRICITY','WATER','INTERNET','TRANSPORTATION','MARKETING',
     'PACKAGING','SALARIES','MAINTENANCE','BANK_CHARGES','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.request_status as enum
    ('NEW','CONTACTED','CONFIRMED','ORDERED_FROM_SUPPLIER','AVAILABLE','FULFILLED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.request_source as enum ('WEBSITE','WHATSAPP','TELEGRAM','STAFF');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.record_status as enum ('DUE','PAID','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.period_status as enum ('OPEN','CLOSED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.supplier_user_status as enum ('ACTIVE','DISABLED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Document numbering:  S-000123, RST-000045, CR-0001, ...
-- Atomic under concurrency via a single upsert that takes a row lock.
-- ---------------------------------------------------------------------------
create table if not exists public.number_sequences (
  prefix       text        primary key,
  last_value   bigint      not null default 0,
  updated_at   timestamptz not null default now()
);

create or replace function public.fn_next_number(p_prefix text, p_pad int default 6)
returns text
language plpgsql
as $$
declare
  v_next bigint;
begin
  insert into public.number_sequences (prefix, last_value)
  values (p_prefix, 1)
  on conflict (prefix) do update
    set last_value = public.number_sequences.last_value + 1,
        updated_at = now()
  returning last_value into v_next;

  return p_prefix || '-' || lpad(v_next::text, greatest(p_pad, 1), '0');
end $$;

-- ---------------------------------------------------------------------------
-- Settings registry
--   is_public = true  -> readable by anonymous customers (phone numbers etc.)
--   is_public = false -> owner-only (bot tokens, business config)
-- Never store a bot token in a public row.
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key         text        primary key,
  value       jsonb       not null,
  is_public   boolean     not null default false,
  description text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

comment on table public.settings is
  'Key/value configuration. Only rows with is_public = true are visible to the public customer portal.';

-- ---------------------------------------------------------------------------
-- Audit log — append-only, no UPDATE/DELETE policy is ever created,
-- so RLS makes history immutable even for the Owner.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid,
  actor_email  text,
  action       text        not null,          -- e.g. PRODUCTS_UPDATE, VOID_SALE, TITHE_PAYMENT
  entity_type  text        not null,
  entity_id    uuid,
  old_value    jsonb,
  new_value    jsonb,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx  on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_action_idx  on public.audit_logs (action);

-- Generic row-level audit trigger. Attached to every table whose contents are
-- financially or operationally sensitive, so that no future code path can
-- change a sensitive row without leaving a trace.
create or replace function public.fn_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_email text;
  v_entity_id uuid;
begin
  v_actor := auth.uid();
  select email into v_email from public.app_users where id = v_actor;

  if (tg_op = 'DELETE') then
    v_entity_id := (to_jsonb(old) ->> 'id')::uuid;
    insert into public.audit_logs (user_id, actor_email, action, entity_type, entity_id, old_value)
    values (v_actor, v_email, tg_table_name || '_DELETE', tg_table_name, v_entity_id, to_jsonb(old));
    return old;
  elsif (tg_op = 'UPDATE') then
    v_entity_id := (to_jsonb(new) ->> 'id')::uuid;
    insert into public.audit_logs (user_id, actor_email, action, entity_type, entity_id, old_value, new_value)
    values (v_actor, v_email, tg_table_name || '_UPDATE', tg_table_name, v_entity_id, to_jsonb(old), to_jsonb(new));
    return new;
  else
    v_entity_id := (to_jsonb(new) ->> 'id')::uuid;
    insert into public.audit_logs (user_id, actor_email, action, entity_type, entity_id, new_value)
    values (v_actor, v_email, tg_table_name || '_INSERT', tg_table_name, v_entity_id, to_jsonb(new));
    return new;
  end if;
end $$;

-- Helper for RPCs that need to record an action that is not a plain row diff.
create or replace function public.fn_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid default null,
  p_old         jsonb default null,
  p_new         jsonb default null,
  p_note        text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
begin
  select email into v_email from public.app_users where id = v_actor;
  insert into public.audit_logs (user_id, actor_email, action, entity_type, entity_id, old_value, new_value, note)
  values (v_actor, v_email, p_action, p_entity_type, p_entity_id, p_old, p_new, p_note);
end $$;

-- Money rounding, half-up at 2dp, in one place so the ledger, the P&L and the
-- supplier statement can never disagree by a cent.
create or replace function public.fn_money(p_value numeric)
returns numeric
language sql
immutable
as $$
  select round(coalesce(p_value, 0)::numeric, 2);
$$;
