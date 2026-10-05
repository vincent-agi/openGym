#!/usr/bin/env bash
# desc: Restore a backup archive (validated first; old data is kept, never deleted)
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/alert.sh
. "$_here/lib/alert.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"
# shellcheck source=../lib/data.sh
. "$_here/lib/data.sh"
# shellcheck source=../lib/archive.sh
. "$_here/lib/archive.sh"

usage() {
  cat <<'USAGE'
Usage: opengym restore <archive> [--dry-run] [--yes] [--no-start] [--identity FILE]

Restores data/ (and .env when the archive has one) from a backup made by `opengym backup`.
Nothing is touched until the archive passed every check: checksum, safe paths, valid JSON.
The current data/ is moved to data.broken.<timestamp>, never deleted.

  --dry-run        validate and show what would change, change nothing
  --yes, -y        do not ask for confirmation
  --no-start       leave the stack stopped afterwards
  --identity FILE  age identity (private key) to decrypt a .age archive (or set BACKUP_AGE_IDENTITY)
  -h, --help       this help
USAGE
}

ARCHIVE='' DRY_RUN=0 START=1 IDENTITY=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    --no-start) START=0 ;;
    --identity)
      shift
      IDENTITY="${1:-}"
      [ -n "$IDENTITY" ] || die_usage "--identity needs a file"
      ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; die_usage "unknown option '$1'" ;;
    *)
      [ -z "$ARCHIVE" ] || die_usage "only one archive can be restored"
      ARCHIVE="$1"
      ;;
  esac
  shift
done
[ -n "$ARCHIVE" ] || { usage >&2; die_usage "missing archive argument"; }
export ASSUME_YES="${ASSUME_YES:-0}"

load_config
secure_umask
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"

STATE="$OPENGYM_ROOT/.opengym-state"
(umask 077 && mkdir -p "$STATE")
WORK="$(mktemp -d "$STATE/restore.XXXXXX")"
cleanup() {
  local rc=$?
  trap - EXIT
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT

# 1-4. decrypt, checksum, safe content, extract aside and validate (nothing outside $WORK is touched)
archive_open "$ARCHIVE" "$WORK" "$IDENTITY"

arch_users="$(user_count "$WORK/x/data")"
cur_users="$(user_count "$OPENGYM_ROOT/data")"
info "Archive: $(basename "$ARCHIVE") — ${arch_users:-?} users (current data: ${cur_users:-none or unreadable})"

HAS_ENV=0
[ -f "$WORK/x/.env" ] && HAS_ENV=1
if [ "$HAS_ENV" = 1 ]; then
  for k in RP_ID ORIGIN; do
    a="$(env_value "$WORK/x/.env" "$k")"
    c="$(env_value "$OPENGYM_ROOT/.env" "$k")"
    if [ -n "$c" ] && [ "$a" != "$c" ]; then
      warn "$k differs: backup has '$a', current .env has '$c'. The backup's .env will be restored (passkeys are bound to it); yours is saved as .env.pre-restore.*"
    fi
  done
else
  warn "no .env in the archive: keeping the current .env. Make sure RP_ID and ORIGIN match the instance that made the backup, or passkeys will fail."
fi

TS="$(date +%Y-%m-%d-%H%M%S)"
if [ "$DRY_RUN" = 1 ]; then
  what="data/"
  [ "$HAS_ENV" = 1 ] && what="data/ and .env"
  info "dry-run: would stop the stack, move data/ to data.broken.$TS, restore $what from the archive, start the stack"
  exit 0
fi

confirm "Replace the current data with this backup? (the current data is kept as data.broken.$TS)" || die "aborted. Nothing was changed."

# 5. stop, swap, start
if daemon_up; then
  compose_cmd down >/dev/null 2>&1 || die "could not stop the stack. Nothing was changed."
else
  warn "Docker is not running: could not stop the stack (nothing should be using the data)"
fi

BROKEN="$OPENGYM_ROOT/data.broken.$TS"
n=1
while [ -e "$BROKEN" ]; do
  BROKEN="$OPENGYM_ROOT/data.broken.$TS-$n"
  n=$((n + 1))
done
MOVED=0
if [ -e "$OPENGYM_ROOT/data" ]; then
  mv "$OPENGYM_ROOT/data" "$BROKEN" || die "could not move the current data aside. Nothing was changed."
  MOVED=1
fi
if ! mv "$WORK/x/data" "$OPENGYM_ROOT/data"; then
  [ "$MOVED" = 1 ] && mv "$BROKEN" "$OPENGYM_ROOT/data"
  die "could not put the restored data in place; the previous data was put back."
fi
if [ "$HAS_ENV" = 1 ]; then
  if [ -f "$OPENGYM_ROOT/.env" ]; then
    cp -p "$OPENGYM_ROOT/.env" "$OPENGYM_ROOT/.env.pre-restore.$TS"
  fi
  cp "$WORK/x/.env" "$OPENGYM_ROOT/.env"
  chmod 600 "$OPENGYM_ROOT/.env" 2>/dev/null || true
fi
log_info "restored data from $ARCHIVE (previous data: $BROKEN)"

UNDO="opengym stop; mv data data.failed; mv $(basename "$BROKEN") data; opengym start"
if [ "$START" = 0 ]; then
  ok "data restored; stack left stopped (--no-start). Previous data: $(basename "$BROKEN")"
  exit 0
fi
if ! daemon_up; then
  ok "data restored. Docker is not running: start openGym with: opengym start"
  exit 0
fi
compose_cmd up -d >/dev/null 2>&1 || die "data restored but the stack did not start. See: opengym logs. To undo: $UNDO"
if ! wait_health "$BASE_URL/api/health" 120; then
  alert crit restore-health "openGym restore: API not answering" "Data was restored from $(basename "$ARCHIVE") but $BASE_URL/api/health does not answer."
  die "data restored but the API does not answer at $BASE_URL. Check: opengym logs. To undo: $UNDO (previous data: $(basename "$BROKEN"))"
fi

live_users=""
if body="$(fetch_health)"; then
  live_users="$(printf '%s' "$body" | jq -r '.users // empty' 2>/dev/null || true)"
fi
if [ -n "$live_users" ] && [ -n "$arch_users" ] && [ "$live_users" != "$arch_users" ]; then
  warn "the API reports $live_users users but the backup had $arch_users. Check that the right backup was restored."
fi
ok "restored from $(basename "$ARCHIVE") — ${live_users:-$arch_users} users. Sign in with a known account to confirm."
info "Previous data kept in $(basename "$BROKEN") (delete it once you are satisfied)."
