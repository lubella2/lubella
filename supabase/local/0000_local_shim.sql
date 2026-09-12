-- ============================================================================
-- LuBella  |  LOCAL DEVELOPMENT SHIM  (not part of the Supabase migrations)
-- ============================================================================
-- Recreates the small pieces of the Supabase environment that the migrations
-- depend on, so that the real migrations can be executed and tested against a
-- plain PostgreSQL instance (and therefore offline / in CI).
--
-- Apply this BEFORE 0001 on a bare PostgreSQL:
--     psql -d lubella -f supabase/local/0000_local_shim.sql
--
-- On hosted Supabase this file is never used: auth.*, the roles and the
-- `extensions` schema already exist there.
-- ============================================================================

create schema if not exists auth;
create schema if not exists extensions;

-- pgcrypto lives in the extensions schema on Supabase; mirror that.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- auth.uid() / auth.jwt() — read the claims the request carries, exactly as
-- Supabase does. The dev gateway sets these per request:
--     set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  );
$$;

-- ---------------------------------------------------------------------------
-- Minimal auth.users, so the local stack can create accounts the same way the
-- Supabase Admin API does server-side. Passwords are bcrypt via pgcrypto.
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  id                 uuid        primary key default gen_random_uuid(),
  email              text        unique not null,
  encrypted_password text,
  email_confirmed_at timestamptz default now(),
  raw_user_meta_data jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  banned_until       timestamptz
);

create or replace function auth.create_user(
  p_email    text,
  p_password text,
  p_meta     jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = auth, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into auth.users (email, encrypted_password, raw_user_meta_data)
  values (lower(btrim(p_email)), extensions.crypt(p_password, extensions.gen_salt('bf')), p_meta)
  on conflict (email) do update
    set encrypted_password = excluded.encrypted_password,
        raw_user_meta_data = excluded.raw_user_meta_data,
        updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Verifies credentials the way the dev gateway's /auth/v1/token endpoint needs.
create or replace function auth.verify_password(p_email text, p_password text)
returns uuid
language sql
stable
security definer
set search_path = auth, extensions, pg_temp
as $$
  select u.id
  from auth.users u
  where u.email = lower(btrim(p_email))
    and u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
    and (u.banned_until is null or u.banned_until < now());
$$;
