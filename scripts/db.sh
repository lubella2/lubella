#!/usr/bin/env bash
# ============================================================================
# LuBella  |  Database harness
# ============================================================================
#   scripts/db.sh reset   drop + recreate + apply shim, migrations and fixture
#   scripts/db.sh test    run the full test suite against the current database
#   scripts/db.sh sql     open a psql session
#   scripts/db.sh serve   start the API gateway used by the web app (see below)
#
# Works against either:
#   * a local PostgreSQL (default), or
#   * Supabase, by exporting DATABASE_URL=postgres://...
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${DB_NAME:-lubella}"
export PGHOST="${PGHOST:-localhost}"
export PGUSER="${PGUSER:-user}"
export PGPASSWORD="${PGPASSWORD:-user}"
PSQL=(psql -v ON_ERROR_STOP=1)

if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL=(psql -v ON_ERROR_STOP=1 "$DATABASE_URL")
else
  PSQL=(psql -v ON_ERROR_STOP=1 -d "$DB_NAME")
fi

apply_shim() {
  # On hosted Supabase the auth schema, roles and extensions schema already
  # exist, so this file is skipped entirely.
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "· hosted database detected — skipping local auth shim"
  else
    echo "· applying local auth/extensions shim"
    "${PSQL[@]}" -q -f "$ROOT/supabase/local/0000_local_shim.sql"
  fi
}

apply_migrations() {
  for f in "$ROOT"/supabase/migrations/*.sql; do
    printf '  → %s\n' "$(basename "$f")"
    "${PSQL[@]}" -q -f "$f"
  done
}

case "${1:-test}" in
  reset)
    if [[ -z "${DATABASE_URL:-}" ]]; then
      echo "· resetting schema public in $DB_NAME"
      "${PSQL[@]}" -q -c "drop schema if exists public cascade; create schema public; drop schema if exists testing cascade;"
    fi
    apply_shim
    echo "· applying migrations"
    apply_migrations
    echo "· applying test support + fixture"
    "${PSQL[@]}" -q -f "$ROOT/supabase/tests/00_test_support.sql"
    "${PSQL[@]}" -q -f "$ROOT/supabase/tests/01_fixture.sql"

    # The fixture seeds only the settings the assertions depend on, so that the
    # tests are exact. Re-apply the production defaults (idempotent, and it will
    # not overwrite what the fixture already set) so a freshly reset dev database
    # still looks like the shop when you open the app: name, address, contact
    # details, receipt footer.
    if [[ -z "${DATABASE_URL:-}" ]]; then
      "${PSQL[@]}" -q -f "$ROOT/supabase/migrations/0017_settings_seed.sql"
      echo "· dev settings restored from 0017 (the fixture seeds only test keys)"
    fi
    echo "✓ database ready"
    ;;

  test)
    if [[ "${RESET:-0}" == "1" ]]; then
      "$0" reset
    fi
    echo "· business rules"
    "${PSQL[@]}" -q -f "$ROOT/supabase/tests/02_business_rules.sql" >/dev/null
    echo "· security / RLS"
    "${PSQL[@]}" -q -f "$ROOT/supabase/tests/03_security_rls.sql" >/dev/null
    "${PSQL[@]}" -c "select suite, passed, failed from testing.report();"
    FAILED=$("${PSQL[@]}" -tAc "select count(*) from testing.results where not ok;")
    if [[ "$FAILED" != "0" ]]; then
      echo
      echo "✗ $FAILED assertion(s) failed:"
      "${PSQL[@]}" -c "select suite, name, detail from testing.results where not ok order by suite, name;"
      exit 1
    fi
    echo "✓ all assertions passed"
    ;;

  sql)
    exec "${PSQL[@]}"
    ;;

  serve)
    exec node "$ROOT/devserver/server.mjs"
    ;;

  *)
    echo "usage: scripts/db.sh {reset|test|sql|serve}" >&2
    exit 2
    ;;
esac
