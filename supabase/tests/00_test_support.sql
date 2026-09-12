-- ============================================================================
-- LuBella  |  Test support
-- ============================================================================
create schema if not exists testing;

-- The security suite switches to the real `anon` / `authenticated` roles and
-- calls these helpers from there, so the schema must be reachable by them.
-- The helpers are SECURITY DEFINER, so only name resolution happens as the
-- caller; the INSERT into results runs as the owner.
grant usage on schema testing to anon, authenticated;

drop table if exists testing.results cascade;
create table testing.results (
  id     bigserial primary key,
  suite  text not null,
  name   text not null,
  ok     boolean not null,
  detail text,
  at     timestamptz not null default now()
);

-- SECURITY DEFINER so results can be recorded no matter which role the test is
-- currently running as (including anon).
create or replace function testing.check(p_suite text, p_name text, p_ok boolean, p_detail text default null)
returns boolean
language plpgsql
security definer
set search_path = testing, public, pg_temp
as $$
begin
  insert into testing.results (suite, name, ok, detail) values (p_suite, p_name, coalesce(p_ok, false), p_detail);
  if not coalesce(p_ok, false) then
    raise warning 'FAIL [%] %  ->  %', p_suite, p_name, coalesce(p_detail, '');
  end if;
  return coalesce(p_ok, false);
end $$;

create or replace function testing.eq(p_suite text, p_name text, p_actual numeric, p_expected numeric)
returns boolean
language plpgsql
security definer
set search_path = testing, public, pg_temp
as $$
begin
  return testing.check(p_suite, p_name, p_actual is not distinct from p_expected,
                       format('expected %s, got %s', p_expected, p_actual));
end $$;

create or replace function testing.eq_text(p_suite text, p_name text, p_actual text, p_expected text)
returns boolean
language plpgsql
security definer
set search_path = testing, public, pg_temp
as $$
begin
  return testing.check(p_suite, p_name, p_actual is not distinct from p_expected,
                       format('expected %L, got %L', p_expected, p_actual));
end $$;

create or replace function testing.eq_int(p_suite text, p_name text, p_actual int, p_expected int)
returns boolean
language plpgsql
security definer
set search_path = testing, public, pg_temp
as $$
begin
  return testing.check(p_suite, p_name, p_actual is not distinct from p_expected,
                       format('expected %s, got %s', p_expected, p_actual));
end $$;

-- Runs p_sql and records PASS when it raises (used for negative tests such as
-- "staff must NOT be able to read purchase_batches").
--
-- SECURITY INVOKER on purpose: the probe has to execute with the CALLER's
-- privileges, otherwise a definer-context helper would run every "attack" as
-- the superuser owner and report that nothing was blocked. Results are still
-- recorded through testing.check(), which is definer.
create or replace function testing.expect_error(p_suite text, p_name text, p_sql text)
returns boolean
language plpgsql
set search_path = testing, public, pg_temp
as $$
declare
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    return testing.check(p_suite, p_name, true, 'blocked as expected: ' || sqlerrm);
  end;
  return testing.check(p_suite, p_name, false, 'the statement was ALLOWED but should have been refused');
end $$;

create or replace function testing.expect_error_like(p_suite text, p_name text, p_sql text, p_pattern text)
returns boolean
language plpgsql
set search_path = testing, public, pg_temp
as $$
declare
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
    return testing.check(p_suite, p_name, v_msg ilike '%' || p_pattern || '%',
                         'raised: ' || v_msg || ' (wanted to match ' || p_pattern || ')');
  end;
  return testing.check(p_suite, p_name, false, 'the statement was ALLOWED but should have been refused');
end $$;

create or replace function testing.report()
returns table (suite text, passed bigint, failed bigint, failures text)
language sql
stable
as $$
  select r.suite,
         count(*) filter (where r.ok) as passed,
         count(*) filter (where not r.ok) as failed,
         coalesce(string_agg(r.name || ' [' || coalesce(r.detail, '') || ']', E'\n    ')
                  filter (where not r.ok), '') as failures
  from testing.results r
  group by r.suite
  order by r.suite;
$$;
