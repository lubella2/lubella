#!/usr/bin/env bash
# ============================================================================
# LuBella  |  Weekly backup
# ============================================================================
#   DATABASE_URL="postgres://…" ./scripts/backup.sh
#
# Takes a plain SQL dump of the shop's database, gzips it, keeps the newest
# KEEP copies and deletes the rest. After it runs, record the run in the app:
#   Settings → Backups → Record a run      (that is what the dashboard reads)
#
# Environment:
#   DATABASE_URL   required — Supabase connection string (session pooler or direct)
#   BACKUP_DIR     optional — where to write (default: ~/lubella-backups)
#   KEEP           optional — how many dumps to retain (default: 8)
#
# The dump keeps privileges and drops ownership (--no-owner only). That matters:
# a dump taken with --no-privileges restores a database whose GRANT/REVOKE state
# is gone, which means the anonymous API surface quietly widens — functions go
# back to the CREATE-default "EXECUTE to PUBLIC". Keep the grants in the dump.
# (--no-owner means it can still be restored into a fresh Supabase project: anon,
# authenticated and service_role exist there, and object ownership is re-created
# by the restoring role.)
#
# Restore (into an empty project):
#   gunzip -c lubella-YYYY-MM-DD.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
#   psql "$DATABASE_URL" -f supabase/migrations/9999_api_grants.sql   # belt and braces
#   psql "$DATABASE_URL" -f scripts/verify_production.sql             # must be 11 / 0
#
# Restoring into a plain PostgreSQL (no Supabase auth roles) is not a supported
# target — use the local shim instead: supabase/local/0000_local_shim.sql.
# ============================================================================
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the Supabase connection string}"

OUT_DIR="${BACKUP_DIR:-$HOME/lubella-backups}"
KEEP="${KEEP:-8}"
STAMP="$(date +%F-%H%M)"
FILE="$OUT_DIR/lubella-$STAMP.sql.gz"

command -v pg_dump >/dev/null 2>&1 || {
  echo "✗ pg_dump not found — install a PostgreSQL client first" >&2
  echo "  macOS: brew install libpq | Debian/Ubuntu: apt install postgresql-client" >&2
  exit 1
}

mkdir -p "$OUT_DIR"

echo "· dumping to $FILE"
pg_dump "$DATABASE_URL" --no-owner | gzip > "$FILE"

# Rotate: keep the newest $KEEP dumps.
if [[ "$KEEP" =~ ^[0-9]+$ ]] && (( KEEP > 0 )); then
  ls -1t "$OUT_DIR"/lubella-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
fi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ backup written — $SIZE"
ls -1t "$OUT_DIR"/lubella-*.sql.gz | head -n "$KEEP" | sed 's/^/    /'
echo
echo "  Next: store a copy outside this machine (drive, B2, private repo),"
echo "  then press Record a run in the app → Settings → Backups."
