#!/usr/bin/env bash
# desc: Rotate the session key or the push (VAPID) keys, with a backup first
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

usage() {
  cat <<'USAGE'
Usage: opengym rotate-keys session|vapid [--dry-run] [--yes]

  session   delete data/secret and restart the API: every user is signed out and signs in again with their passkey.
            Use it after a suspected cookie or secret leak (this is the "instance-wide logout").
  vapid     delete data/vapid.json and restart the API: every push subscription dies and each user must re-enable
            notifications in Settings.

A backup is always taken first (it still contains the old key: delete old backups if the key was compromised).
Then the file is removed, the API restarted, and the new key file is checked.

  --dry-run   show the plan, change nothing
  --yes, -y   do not ask for confirmation
  -h, --help  this help
USAGE
}

KIND='' DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    session | vapid)
      [ -z "$KIND" ] || die_usage "only one key can be rotated at a time"
      KIND="$1"
      ;;
    --dry-run) DRY_RUN=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown argument '$1' (expected session or vapid)" ;;
  esac
  shift
done
[ -n "$KIND" ] || { usage >&2; die_usage "say which key to rotate: session or vapid"; }
export ASSUME_YES="${ASSUME_YES:-0}"

load_config
secure_umask

case "$KIND" in
  session) FILE="$OPENGYM_ROOT/data/secret" IMPACT="Every user will be signed out and must sign in again with their passkey." ;;
  vapid) FILE="$OPENGYM_ROOT/data/vapid.json" IMPACT="All push subscriptions will stop working: every user must re-enable notifications in Settings." ;;
esac

if [ ! -f "$FILE" ]; then
  ok "$(basename "$FILE") does not exist yet (the API creates it at start): nothing to rotate"
  exit 0
fi

warn "$IMPACT"
if [ "$DRY_RUN" = 1 ]; then
  info "dry-run: would back up, delete $(basename "$FILE"), restart the api and check that a new key was created"
  exit 0
fi
confirm "Rotate the $KIND key now?" || die "aborted. Nothing was changed."

info "Backing up first…"
BACKUP_FILE="$("${BASH:-bash}" "${BASH_SOURCE[0]%/*}/../user/backup.sh" --quiet --consistent 2>/dev/null | tail -n 1)" ||
  die "the backup failed, so nothing was rotated. Fix it (opengym backup) and retry."
info "Backup: $BACKUP_FILE (contains the OLD key)"

rm -f "$FILE"
log_info "rotate-keys: removed $(basename "$FILE")"

if ! daemon_up; then
  warn "Docker is not running: the old key is gone; a new one is created at the next start (opengym start)."
  exit 0
fi
compose_cmd restart api >/dev/null 2>&1 || die "the key file was removed but the api failed to restart. Run: opengym start"
wait_health "$BASE_URL/api/health" 120 || die "the key was rotated but the API does not answer at $BASE_URL. Check: opengym logs api --errors"

if [ ! -f "$FILE" ]; then
  warn "the API did not create a new $(basename "$FILE"). Check: opengym logs api --errors"
  exit 10
fi
[ "$(file_mode "$FILE")" = 600 ] || warn "$(basename "$FILE") has mode $(file_mode "$FILE"), expected 600"
alert info "rotate-keys-$KIND" "openGym $KIND key rotated" "$IMPACT Backup: $(basename "$BACKUP_FILE")"
ok "$KIND key rotated. $IMPACT"
