#!/usr/bin/env bash
# ============================================================================
# LuBella  |  Backup to Google Drive
# ============================================================================
#   Two ways to get the weekly dump into Google Drive. Both are supported here:
#
#   1. DESKTOP-APP MODE — the Google Drive app is installed and syncing a
#      folder on this machine. No OAuth, no API, nothing to expire:
#
#        DATABASE_URL="postgres://…" \
#        DRIVE_DIR="$HOME/Google Drive/My Drive/LuBella Backups" \
#        ./scripts/backup_to_drive.sh
#
#   2. RCLONE MODE — Drive reached directly over the API, so it works on a
#      server or from GitHub Actions with no desktop app at all:
#
#        DATABASE_URL="postgres://…" DRIVE_REMOTE=gdrive ./scripts/backup_to_drive.sh
#
# Environment:
#   DATABASE_URL   required — Supabase connection string
#   DRIVE_DIR      desktop-app mode: a local folder that Google Drive syncs
#   DRIVE_REMOTE   rclone mode: name of the configured rclone remote (e.g. gdrive)
#   DRIVE_PATH     rclone mode: folder inside that remote  (default: LuBella Backups)
#   KEEP           how many copies to keep in the Drive (default: 12)
#   BACKUP_DIR     where the dump is written locally first (default: ~/lubella-backups)
#
# Exit codes: 0 = dumped and uploaded, 1 = something failed and nothing was
# pruned (fail loudly — a backup that silently stops running is worse than none).
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?set DATABASE_URL to the Supabase connection string}"

KEEP="${KEEP:-12}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/lubella-backups}"
DRIVE_REMOTE="${DRIVE_REMOTE:-}"
DRIVE_PATH="${DRIVE_PATH:-LuBella Backups}"
DRIVE_DIR="${DRIVE_DIR:-}"

if [[ -z "$DRIVE_REMOTE" && -z "$DRIVE_DIR" ]]; then
  cat >&2 <<'MSG'
✗ Nothing to upload to. Choose one:

  desktop-app mode:  DRIVE_DIR="$HOME/Google Drive/My Drive/LuBella Backups" …
  rclone mode:       DRIVE_REMOTE=gdrive …

  See docs/07-GO-LIVE.md step 10.4 for the ten-minute setup of either.
MSG
  exit 1
fi

# ---------------------------------------------------------------- 1. the dump
echo "· 1/4 taking the dump"
DATABASE_URL="$DATABASE_URL" BACKUP_DIR="$BACKUP_DIR" KEEP="$KEEP" \
  "$ROOT/scripts/backup.sh" | sed 's/^/    /'
FILE="$(ls -1t "$BACKUP_DIR"/lubella-*.sql.gz | head -1)"
LOCAL_SIZE="$(stat -c %s "$FILE" 2>/dev/null || stat -f %z "$FILE")"
echo "    $FILE ($(du -h "$FILE" | cut -f1))"

# ------------------------------------------------------------- 2. desktop mode
if [[ -n "$DRIVE_DIR" ]]; then
  if [[ ! -d "$DRIVE_DIR" ]]; then
    echo "✗ DRIVE_DIR does not exist: $DRIVE_DIR" >&2
    echo "  Is the Google Drive desktop app installed and is that folder syncing?" >&2
    exit 1
  fi
  echo "· 2/4 copying into the Drive-synced folder"
  cp "$FILE" "$DRIVE_DIR/"
  echo "    copied to $DRIVE_DIR/$(basename "$FILE")"
  echo "· 3/4 checking the copy"
  REMOTE_SIZE="$(stat -c %s "$DRIVE_DIR/$(basename "$FILE")")"
  [[ "$REMOTE_SIZE" == "$LOCAL_SIZE" ]] || { echo "✗ size mismatch after copy" >&2; exit 1; }
  echo "    sizes match ($LOCAL_SIZE bytes) — Google Drive will sync it up"
  echo "· 4/4 pruning old copies in $DRIVE_DIR (keeping $KEEP)"
  # shellcheck disable=SC2012
  ls -1t "$DRIVE_DIR"/lubella-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
  ls -1t "$DRIVE_DIR"/lubella-*.sql.gz 2>/dev/null | sed 's|.*/|    |'
  echo
  echo "✓ backup is in Google Drive (once the app finishes syncing)"
  echo "  Remember: Settings → Backups → Record a run"
  exit 0
fi

# ---------------------------------------------------------------- 3. rclone mode
command -v rclone >/dev/null 2>&1 || {
  echo "✗ rclone not found — https://rclone.org/install/" >&2
  echo "  macOS: brew install rclone | Windows: winget install Rclone.Rclone" >&2
  echo "  Or use desktop-app mode with DRIVE_DIR instead." >&2
  exit 1
}

DEST="$DRIVE_REMOTE:$DRIVE_PATH"

if ! rclone lsd "$DRIVE_REMOTE:" >/dev/null 2>&1; then
  echo "✗ rclone remote '$DRIVE_REMOTE' is not usable." >&2
  echo "  Configure it once with: rclone config   (see docs/07-GO-LIVE.md step 10.4)" >&2
  echo "  Test it with:           rclone lsd $DRIVE_REMOTE:" >&2
  exit 1
fi

echo "· 2/4 uploading to $DEST"
rclone copyto "$FILE" "$DEST/$(basename "$FILE")" --stats-one-line --stats 0

echo "· 3/4 verifying what is actually in the Drive"
REMOTE_SIZE="$(rclone lsf --files-only --format sp "$DEST/$(basename "$FILE")" | cut -d';' -f1)"
if [[ "${REMOTE_SIZE:-0}" != "$LOCAL_SIZE" ]]; then
  echo "✗ size mismatch: local $LOCAL_SIZE bytes, Drive ${REMOTE_SIZE:-nothing} bytes" >&2
  exit 1
fi
echo "    Drive holds $(basename "$FILE"), $REMOTE_SIZE bytes — identical"

echo "· 4/4 pruning old copies (keeping the newest $KEEP)"
mapfile -t ENTRIES < <(rclone lsf --files-only --format "tp" "$DEST" | sort)
COUNT="${#ENTRIES[@]}"
if (( COUNT > KEEP )); then
  for entry in "${ENTRIES[@]:0:$((COUNT - KEEP))}"; do
    name="${entry#*;}"
    rclone deletefile "$DEST/$name" && echo "    removed $name"
  done
else
  echo "    $COUNT cop$([[ $COUNT -eq 1 ]] && echo y || echo ies) in the Drive, nothing to remove"
fi

echo
echo "✓ backup is in Google Drive"
echo "  Remember: Settings → Backups → Record a run"
