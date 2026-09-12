-- ============================================================================
-- LuBella  |  Migration 0015 — Administration RPCs
-- ============================================================================
-- Staff & supplier accounts, categories, settings, audit queries, backups.
-- Account creation is two-step by design: the Auth user is created with the
-- service key (edge function / gateway), then linked here. The anon key alone
-- can never mint a privileged account.
-- ============================================================================

-- ===========================================================================
-- Staff
-- ===========================================================================
create or replace function public.rpc_register_app_user(
  p_user_id       uuid,
  p_email         text,
  p_full_name     text,
  p_role          public.user_role,
  p_phone         text default null,
  p_commission_rate numeric default 0.03
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users;
begin
  v_user := public.fn_current_user_row();

  -- The very first account bootstraps the shop and must be the Owner.
  if not exists (select 1 from public.app_users where role = 'OWNER') then
    if p_role <> 'OWNER' then
      raise exception 'BOOTSTRAP: the first account must be the OWNER' using errcode = '42501';
    end if;
  else
    perform public.fn_require_owner();
    if p_role = 'OWNER' and v_user.id is null then
      raise exception 'OWNER_ONLY: cannot create a second owner from the API' using errcode = '42501';
    end if;
  end if;

  insert into public.app_users (id, email, full_name, phone, role, commission_rate, created_by)
  values (p_user_id, lower(btrim(p_email)), btrim(p_full_name), p_phone, p_role,
          case when p_role = 'OWNER' then 0 else coalesce(p_commission_rate, 0.03) end,
          v_user.id)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name, role = excluded.role,
        phone = excluded.phone, commission_rate = excluded.commission_rate
  returning * into v_user;

  perform public.fn_audit('APP_USER_REGISTER', 'app_users', v_user.id, null,
    jsonb_build_object('email', v_user.email, 'role', v_user.role,
                       'commission_rate', v_user.commission_rate));

  return jsonb_build_object('user_id', v_user.id, 'role', v_user.role, 'email', v_user.email);
end $$;

create or replace function public.rpc_update_staff(
  p_user_id         uuid,
  p_full_name       text default null,
  p_phone           text default null,
  p_commission_rate numeric default null,
  p_active          boolean default null,
  p_note            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.app_users;
  v_after  public.app_users;
begin
  perform public.fn_require_owner();

  select * into v_before from public.app_users where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND: no user with id %', p_user_id using errcode = '23503';
  end if;
  if v_before.role = 'OWNER' and p_active = false then
    raise exception 'OWNER_PROTECTED: the owner account cannot be deactivated' using errcode = '42501';
  end if;

  update public.app_users
     set full_name = coalesce(p_full_name, full_name),
         phone = coalesce(p_phone, phone),
         -- commission rate is clamped to the contractual maximum of 3%
         commission_rate = case when p_commission_rate is null then commission_rate
                                else least(greatest(p_commission_rate, 0), 0.03) end,
         active = coalesce(p_active, active),
         note = coalesce(p_note, note)
   where id = p_user_id
  returning * into v_after;

  perform public.fn_audit(
    case when v_before.active and not v_after.active then 'STAFF_DEACTIVATE'
         when not v_before.active and v_after.active then 'STAFF_ACTIVATE'
         else 'STAFF_UPDATE' end,
    'app_users', p_user_id,
    jsonb_build_object('full_name', v_before.full_name, 'active', v_before.active,
                       'commission_rate', v_before.commission_rate),
    jsonb_build_object('full_name', v_after.full_name, 'active', v_after.active,
                       'commission_rate', v_after.commission_rate, 'note', p_note));

  return jsonb_build_object('user_id', p_user_id, 'active', v_after.active,
                            'commission_rate', v_after.commission_rate);
end $$;

-- ===========================================================================
-- Suppliers
-- ===========================================================================
create or replace function public.rpc_upsert_supplier(
  p_name         text,
  p_supplier_id  uuid default null,
  p_contact_name text default null,
  p_phone        text default null,
  p_email        text default null,
  p_address      text default null,
  p_tin_number   text default null,
  p_payment_terms text default null,
  p_active       boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_code text;
  v_before public.suppliers;
begin
  perform public.fn_require_owner();

  if p_supplier_id is null then
    v_code := public.fn_next_number('SUP', 4);
    insert into public.suppliers (supplier_code, name, contact_name, phone, email, address,
                                  tin_number, payment_terms)
    values (v_code, btrim(p_name), p_contact_name, p_phone, p_email, p_address,
            p_tin_number, coalesce(p_payment_terms, 'Monthly settlement on units sold'))
    returning id into v_id;
  else
    select * into v_before from public.suppliers where id = p_supplier_id;
    if not found then
      raise exception 'SUPPLIER_NOT_FOUND: no supplier with id %', p_supplier_id using errcode = '23503';
    end if;
    update public.suppliers
       set name = coalesce(p_name, name), contact_name = coalesce(p_contact_name, contact_name),
           phone = coalesce(p_phone, phone), email = coalesce(p_email, email),
           address = coalesce(p_address, address), tin_number = coalesce(p_tin_number, tin_number),
           payment_terms = coalesce(p_payment_terms, payment_terms),
           active = coalesce(p_active, active)
     where id = p_supplier_id
    returning id into v_id;
    v_code := v_before.supplier_code;
  end if;

  perform public.fn_audit('SUPPLIER_' ||
      case when p_supplier_id is null then 'CREATE' else 'UPDATE' end,
    'suppliers', v_id, case when p_supplier_id is null then null else to_jsonb(v_before) end,
    jsonb_build_object('name', p_name, 'code', v_code, 'active', p_active));

  return jsonb_build_object('supplier_id', v_id, 'supplier_code', v_code);
end $$;

-- Links an existing Auth user to a supplier. Only the owner can do this, and a
-- supplier user can belong to exactly one supplier.
create or replace function public.rpc_link_supplier_user(
  p_supplier_id uuid,
  p_user_id     uuid,
  p_status      public.supplier_user_status default 'ACTIVE'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_user public.app_users;
begin
  perform public.fn_require_owner();

  select * into v_user from public.app_users where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND: register the account first (rpc_register_app_user)' using errcode = '23503';
  end if;
  if v_user.role <> 'SUPPLIER' then
    raise exception 'WRONG_ROLE: a supplier login must have the SUPPLIER role' using errcode = '22023';
  end if;
  if exists (select 1 from public.supplier_users where user_id = p_user_id and supplier_id <> p_supplier_id) then
    raise exception 'ALREADY_LINKED: this login is already linked to a different supplier' using errcode = '22023';
  end if;

  insert into public.supplier_users (supplier_id, user_id, status)
  values (p_supplier_id, p_user_id, p_status)
  on conflict (supplier_id, user_id) do update set status = excluded.status
  returning id into v_id;

  perform public.fn_audit('SUPPLIER_USER_LINK', 'supplier_users', v_id, null,
    jsonb_build_object('supplier_id', p_supplier_id, 'user_id', p_user_id, 'status', p_status));

  return jsonb_build_object('supplier_user_id', v_id, 'status', p_status);
end $$;

create or replace function public.rpc_set_supplier_user_status(
  p_supplier_user_id uuid,
  p_status           public.supplier_user_status
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.supplier_users;
begin
  perform public.fn_require_owner();
  select * into v_before from public.supplier_users where id = p_supplier_user_id for update;
  if not found then
    raise exception 'LINK_NOT_FOUND: no supplier account link with id %', p_supplier_user_id using errcode = '23503';
  end if;

  update public.supplier_users set status = p_status where id = p_supplier_user_id;

  perform public.fn_audit('SUPPLIER_USER_' || case when p_status = 'ACTIVE' then 'ACTIVATE' else 'DEACTIVATE' end,
    'supplier_users', p_supplier_user_id,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', p_status));

  return jsonb_build_object('supplier_user_id', p_supplier_user_id, 'status', p_status);
end $$;

create or replace function public.rpc_add_supplier_note(p_supplier_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users;
  v_id uuid;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();
  insert into public.supplier_internal_notes (supplier_id, note, created_by)
  values (p_supplier_id, p_note, v_user.id) returning id into v_id;
  perform public.fn_audit('SUPPLIER_NOTE_ADD', 'supplier_internal_notes', v_id, null,
    jsonb_build_object('supplier_id', p_supplier_id));
  return jsonb_build_object('note_id', v_id);
end $$;

-- ===========================================================================
-- Categories
-- ===========================================================================
create or replace function public.rpc_upsert_category(
  p_name        text,
  p_category_id uuid default null,
  p_description text default null,
  p_image_url   text default null,
  p_sort_order  int default 0,
  p_active      boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_slug text;
begin
  perform public.fn_require_owner();

  v_slug := lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');

  if p_category_id is null then
    insert into public.categories (name, slug, description, image_url, sort_order)
    values (btrim(p_name), v_slug, p_description, p_image_url, coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.categories
       set name = btrim(p_name), slug = v_slug,
           description = coalesce(p_description, description),
           image_url = coalesce(p_image_url, image_url),
           sort_order = coalesce(p_sort_order, sort_order),
           active = coalesce(p_active, active)
     where id = p_category_id
    returning id into v_id;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND: no category with id %', p_category_id using errcode = '23503';
    end if;
  end if;

  perform public.fn_audit('CATEGORY_UPSERT', 'categories', v_id, null,
    jsonb_build_object('name', p_name, 'slug', v_slug));
  return jsonb_build_object('category_id', v_id, 'slug', v_slug);
end $$;

-- ===========================================================================
-- Settings (owner-only writes; everything is audit-logged)
-- ===========================================================================
create or replace function public.rpc_update_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users;
  k text;
  v jsonb;
  v_public boolean;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'INVALID_SETTINGS: expected a JSON object of key/value pairs' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p_settings) loop
    v_public := k in ('shop_name','shop_tagline','currency','whatsapp_number',
                      'whatsapp_display','telegram_username','telegram_bot_username',
                      'support_hours','expiry_warning_days','low_stock_band','tithe_rate',
                      'address','phone','email','instagram','tiktok','telegram_order_destination');

    -- Bot tokens and other secrets must never be public rows.
    if k in ('telegram_bot_token','supabase_service_key','backup_location') then
      v_public := false;
    end if;

    insert into public.settings (key, value, is_public, updated_by)
    values (k, v, v_public, v_user.id)
    on conflict (key) do update
      set value = excluded.value, is_public = excluded.is_public,
          updated_by = excluded.updated_by, updated_at = now();

    -- Values of secret keys are masked in the audit trail.
    perform public.fn_audit('SETTINGS_UPDATE', 'settings', null, null,
      jsonb_build_object('key', k,
        'value', case when k in ('telegram_bot_token','supabase_service_key') then '***redacted***' else v end,
        'is_public', v_public));
  end loop;

  return jsonb_build_object('updated', (select count(*) from jsonb_object_keys(p_settings)),
                            'settings', public.fn_public_settings());
end $$;

create or replace function public.rpc_settings_for_admin()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.fn_is_owner()
    then coalesce((select jsonb_object_agg(s.key, jsonb_build_object('value',
      case when s.key in ('telegram_bot_token') then to_jsonb('***set***'::text) else s.value end,
      'is_public', s.is_public, 'description', s.description)) from public.settings s), '{}'::jsonb)
    else '{}'::jsonb end;
$$;

-- ===========================================================================
-- Audit log browsing (owner-only; the table itself is immutable)
-- ===========================================================================
create or replace function public.rpc_audit_log(
  p_action      text default null,
  p_entity_type text default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_limit       int default 100,
  p_offset      int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_total int;
begin
  perform public.fn_require_owner();

  select count(*) into v_total from public.audit_logs a
  where (p_action is null or a.action = p_action)
    and (p_entity_type is null or a.entity_type = p_entity_type)
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at <= p_to);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items
  from (
    select a.id, a.user_id, a.actor_email, a.action, a.entity_type, a.entity_id,
           a.old_value, a.new_value, a.note, a.created_at
    from public.audit_logs a
    where (p_action is null or a.action = p_action)
      and (p_entity_type is null or a.entity_type = p_entity_type)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at <= p_to)
    order by a.created_at desc
    limit greatest(coalesce(p_limit, 100), 1) offset greatest(coalesce(p_offset, 0), 0)
  ) t;

  return jsonb_build_object('items', v_items, 'count', v_total);
end $$;

create or replace function public.rpc_audit_actions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.fn_is_owner()
    then coalesce((select jsonb_agg(x.a) from (select distinct action as a from public.audit_logs order by a) x), '[]'::jsonb)
    else '[]'::jsonb end;
$$;

-- ===========================================================================
-- Backup status (spec §58). Runs are recorded by the scheduled job; the owner
-- sees the result in Settings.
-- ===========================================================================
create or replace function public.rpc_backup_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.fn_is_owner() then jsonb_build_object(
    'last_run', (select to_jsonb(t) from (
        select status, backup_type, started_at, finished_at, size_bytes, table_count,
               row_count, storage_files, location, notes
        from public.backup_runs order by started_at desc limit 1) t),
    'next_scheduled', (select case when max(started_at) is null then now() + interval '7 days'
                                   else max(started_at) + interval '7 days' end
                       from public.backup_runs),
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.started_at desc) from (
        select status, started_at, finished_at, size_bytes, row_count
        from public.backup_runs order by started_at desc limit 8) h), '[]'::jsonb),
    'schedule', 'Weekly, automatic',
    'covers', jsonb_build_array('PostgreSQL data', 'Database recovery', 'Product images (Storage)', 'Configuration settings')
  ) else '{}'::jsonb end;
$$;

create or replace function public.rpc_record_backup_run(
  p_status text, p_size_bytes bigint default null, p_table_count int default null,
  p_row_count bigint default null, p_storage_files int default null,
  p_location text default null, p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.fn_require_owner();
  insert into public.backup_runs (status, finished_at, size_bytes, table_count, row_count,
                                  storage_files, location, notes)
  values (p_status, now(), p_size_bytes, p_table_count, p_row_count, p_storage_files, p_location, p_notes)
  returning id into v_id;
  return jsonb_build_object('backup_id', v_id, 'status', p_status);
end $$;

-- ===========================================================================
-- Profile self-service (any signed-in user, including suppliers)
-- ===========================================================================
create or replace function public.rpc_update_my_profile(
  p_full_name text default null,
  p_phone     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'NOT_SIGNED_IN: sign in first' using errcode = '42501';
  end if;

  update public.app_users
     set full_name = coalesce(p_full_name, full_name),
         phone = coalesce(p_phone, phone),
         last_login_at = now()
   where id = v_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND: no profile is linked to this login' using errcode = '23503';
  end if;

  return jsonb_build_object('user_id', v_id, 'updated', true);
end $$;
