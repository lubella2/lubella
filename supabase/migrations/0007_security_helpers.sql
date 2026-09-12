-- ============================================================================
-- LuBella  |  Migration 0007 — Security helper functions
-- ============================================================================
-- All SECURITY DEFINER with a pinned search_path. These are the primitives that
-- every RLS policy and every RPC guard is built from.
-- ============================================================================

create or replace function public.fn_current_user_row()
returns public.app_users
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.* from public.app_users u where u.id = auth.uid();
$$;

create or replace function public.fn_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role = 'OWNER' and u.active
  );
$$;

create or replace function public.fn_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role = 'STAFF' and u.active
  );
$$;

create or replace function public.fn_is_internal()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role in ('OWNER','STAFF') and u.active
  );
$$;

create or replace function public.fn_current_supplier_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select su.supplier_id
  from public.supplier_users su
  join public.app_users u on u.id = su.user_id
  where su.user_id = auth.uid()
    and su.status = 'ACTIVE'
    and u.active
  limit 1;
$$;

create or replace function public.fn_is_supplier()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.fn_current_supplier_id() is not null;
$$;

-- ---------------------------------------------------------------------------
-- Guards. Raised as SQLSTATE 42501 so the API layer can map them to HTTP 403
-- and the UI can render a friendly "not permitted" state.
-- ---------------------------------------------------------------------------
create or replace function public.fn_require_owner()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.fn_is_owner() then
    raise exception 'OWNER_ONLY: this action is restricted to the shop owner' using errcode = '42501';
  end if;
end $$;

create or replace function public.fn_require_internal()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.fn_is_internal() then
    raise exception 'INTERNAL_ONLY: this action is restricted to LuBella staff' using errcode = '42501';
  end if;
end $$;

create or replace function public.fn_require_open_period(p_date date)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date := date_trunc('month', p_date)::date;
begin
  if exists (select 1 from public.period_closes pc
             where pc.period_month = v_month and pc.status = 'CLOSED') then
    raise exception 'PERIOD_CLOSED: % is closed. Post a controlled, audit-logged adjustment instead.',
      to_char(v_month, 'Mon YYYY') using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Settings access
-- ---------------------------------------------------------------------------
create or replace function public.fn_setting(p_key text, p_default jsonb default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.value from public.settings s where s.key = p_key), p_default);
$$;

-- Safe for any audience: only rows explicitly flagged is_public can ever be
-- returned, so it cannot be used to read the Telegram bot token even though it
-- has the same shape as fn_setting().
create or replace function public.fn_public_setting(p_key text, p_default jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- plpgsql so the definer context cannot be inlined away (see 0008_views.sql).
  return coalesce((select s.value from public.settings s where s.key = p_key and s.is_public), p_default);
end $$;

-- Public settings only: used by the customer portal and by the message builders.
create or replace function public.fn_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
  from public.settings s where s.is_public;
$$;

-- ---------------------------------------------------------------------------
-- Order-message builder (spec §8, §10).
-- Runs on the server so the WhatsApp/Telegram number is never hard-coded in a
-- component, and so message text is consistent between web, bot and staff.
-- ---------------------------------------------------------------------------
create or replace function public.fn_build_order_message(
  p_items   jsonb,      -- [{"name":"Maybelline Lipstick","quantity":2,...}]
  p_total   numeric default null,
  p_customer text default null,
  p_phone    text default null,
  p_kind     text default 'ORDER'   -- ORDER | REQUEST
) returns text
language plpgsql
immutable
as $$
declare
  v_lines text[] := '{}';
  v_item  jsonb;
  v_msg   text;
begin
  if p_kind = 'REQUEST' then
    v_msg := 'Hello LuBella,' || E'\n\n' || 'I would like to request:' || E'\n\n';
  else
    v_msg := 'Hello LuBella,' || E'\n\n' || 'I would like to order:' || E'\n\n';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_lines := v_lines || format('Product: %s' || E'\n' || 'Quantity: %s',
      v_item ->> 'name', coalesce(v_item ->> 'quantity', '1'));
  end loop;

  v_msg := v_msg || array_to_string(v_lines, E'\n\n');

  if p_total is not null and p_total > 0 then
    v_msg := v_msg || E'\n\n' || '----------------' || E'\n' ||
             format('Estimated Total: %s Birr', to_char(p_total, 'FM999,999,999,990.00'));
  end if;

  if p_customer is not null then
    v_msg := v_msg || E'\n\n' || format('Customer: %s', p_customer);
  end if;
  if p_phone is not null then
    v_msg := v_msg || E'\n' || format('Phone: %s', p_phone);
  end if;

  if p_kind = 'REQUEST' then
    v_msg := v_msg || E'\n\n' || 'Please notify me when available.';
  else
    v_msg := v_msg || E'\n\n' || 'Please confirm availability and price.';
  end if;

  v_msg := v_msg || E'\n\n' || 'Thank you.';
  return v_msg;
end $$;

-- Build the deep links the customer portal opens. Uses only PUBLIC settings.
create or replace function public.fn_contact_links(p_message text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_wa    text := coalesce(public.fn_setting('whatsapp_number', 'null'::jsonb) #>> '{}', '');
  v_tg    text := coalesce(public.fn_setting('telegram_username', 'null'::jsonb) #>> '{}', '');
  v_tg_bot text := coalesce(public.fn_setting('telegram_bot_username', 'null'::jsonb) #>> '{}', '');
  v_wa_clean text;
begin
  v_wa_clean := regexp_replace(v_wa, '[^0-9]', '', 'g');
  return jsonb_build_object(
    'whatsapp_number', v_wa,
    'telegram_username', v_tg,
    'whatsapp_url', case when v_wa_clean = '' then null
                    else 'https://wa.me/' || v_wa_clean || '?text=' || public.fn_urlencode(p_message) end,
    'telegram_url', case when v_tg_bot <> '' then 'https://t.me/' || v_tg_bot || '?start=' || public.fn_urlencode(left(p_message, 64))
                    when v_tg <> '' then 'https://t.me/' || v_tg
                    else null end,
    'message', p_message
  );
end $$;

create or replace function public.fn_urlencode(p_text text)
returns text
language sql
immutable
as $$
  select string_agg(
    case
      when c ~ '[A-Za-z0-9_.~-]' then c
      when c = ' ' then '+'
      else '%' || upper(lpad(to_hex(ascii(c)), 2, '0'))
    end, '' order by ord)
  from (
    select substr(p_text, i, 1) as c, i as ord, ascii(substr(p_text, i, 1)) as ascii
    from generate_series(1, greatest(length(p_text), 0)) i
  ) chars;
$$;
