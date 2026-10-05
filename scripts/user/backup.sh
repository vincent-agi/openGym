#!/usr/bin/env bash
# desc: Back up data/ and .env (checksum, optional encryption, retention)
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
Usage: opengym backup [--consistent | --no-consistent] [--quiet] [--dry-run] [--out DIR]

Archives ./data and .env (never media/ or *.tmp) into BACKUP_DIR as opengym-YYYY-MM-DD-HHMMSS.tgz,
mode 0600, with a .sha256 file. The archive path is printed on stdout.

  --consistent      stop the API for a few seconds so db.json and state files are one snapshot (default when run by hand)
  --no-consistent   live copy; each file is atomic but a multi-file operation could straddle the copy
  --quiet           no console output (cron); implies a live backup unless --consistent is also given
  --dry-run         show what would happen, write nothing
  --out DIR         write the archive to DIR instead of BACKUP_DIR (no pruning there)
  -h, --help        this help

Settings (opengym.conf): BACKUP_DIR, BACKUP_KEEP_DAYS (0 = never prune), BACKUP_ENCRYPT_TO (age recipient),
BACKUP_OFFHOST_CMD (run with the archive path as $1).
Exit code: 0 OK · 1 failed · 10 archive written but the off-host hook failed.
USAGE
}

CONSISTENT=auto QUIET=0 DRY_RUN=0 OUT=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --consistent) CONSISTENT=1 ;;
    --no-consistent) CONSISTENT=0 ;;
    --quiet) QUIET=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --out)
      shift
      OUT="${1:-}"
      [ -n "$OUT" ] || die_usage "--out needs a directory"
      ;;
    -y | --yes) ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done

load_config
[ "$QUIET" = 1 ] && export OPENGYM_QUIET=1
secure_umask

ENCRYPT=0
if [ -n "$BACKUP_ENCRYPT_TO" ]; then
  require_cmd age
  ENCRYPT=1
fi
require_cmd tar

fail() {
  log_error "backup failed: $*"
  alert crit backup-failed "openGym backup failed" "$*"
  exit 1
}

[ -f "$OPENGYM_ROOT/data/db.json" ] || fail "no data to back up ($OPENGYM_ROOT/data/db.json is missing)"

DEST="${OUT:-$BACKUP_DIR}"
if [ "$CONSISTENT" = auto ]; then
  if [ "$QUIET" = 1 ]; then CONSISTENT=0; else CONSISTENT=1; fi
fi
LIVE_REASON=''
if [ "$CONSISTENT" = 1 ]; then
  if ! daemon_up; then
    CONSISTENT=0
    LIVE_REASON="Docker is not running: doing a live backup"
  elif ! svc_running api; then
    CONSISTENT=0
    LIVE_REASON="api is not running: nothing to stop, doing a live backup"
  fi
fi

STAMP="$(date +%Y-%m-%d-%H%M%S)"
EXT=tgz
[ "$ENCRYPT" = 1 ] && EXT=tgz.age
ARCHIVE="$DEST/opengym-$STAMP.$EXT"
n=1
while [ -e "$ARCHIVE" ]; do
  ARCHIVE="$DEST/opengym-$STAMP-$n.$EXT"
  n=$((n + 1))
done

if [ "$DRY_RUN" = 1 ]; then
  info "dry-run: would write $ARCHIVE"
  info "dry-run: would include data/ and .env, exclude media/ and *.tmp"
  [ "$CONSISTENT" = 1 ] && info "dry-run: would stop the api briefly for a consistent snapshot" || info "dry-run: would do a live backup${LIVE_REASON:+ ($LIVE_REASON)}"
  [ "$ENCRYPT" = 1 ] && info "dry-run: would encrypt for $BACKUP_ENCRYPT_TO"
  exit 0
fi

[ -n "$LIVE_REASON" ] && log_info "$LIVE_REASON"
[ "$QUIET" = 1 ] || [ "$CONSISTENT" = 1 ] || [ -n "$LIVE_REASON" ] || info "Live backup (use --consistent for a point-in-time snapshot)."

(umask 077 && mkdir -p "$DEST") || fail "cannot create $DEST"
chmod 700 "$DEST" 2>/dev/null || true
PARTIAL="$DEST/.opengym-partial.$$"
STOPPED=0
cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$STOPPED" = 1 ]; then
    compose_cmd start api >/dev/null 2>&1 || log_error "could not restart the api: run: opengym start"
  fi
  rm -f "$PARTIAL" "$PARTIAL.age" "$PARTIAL.list"
  exit "$rc"
}
trap cleanup EXIT

if [ "$CONSISTENT" = 1 ]; then
  compose_cmd stop api >/dev/null 2>&1 || fail "could not stop the api for a consistent snapshot"
  STOPPED=1
fi

FILES=(data)
[ -f "$OPENGYM_ROOT/.env" ] && FILES+=(.env)
rc=0
COPYFILE_DISABLE=1 tar czf "$PARTIAL" --exclude='*.tmp' -C "$OPENGYM_ROOT" "${FILES[@]}" 2>/dev/null || rc=$?
# tar exit 1 = "some files changed while reading" (live backup): acceptable. Anything higher is a failure.
[ "$rc" -le 1 ] || fail "tar failed (exit $rc)"
[ "$rc" -eq 0 ] || log_warn "some files changed while being archived (live backup)"

if [ "$STOPPED" = 1 ]; then
  compose_cmd start api >/dev/null 2>&1 || log_error "could not restart the api: run: opengym start"
  STOPPED=0
fi

tar tzf "$PARTIAL" >"$PARTIAL.list" 2>/dev/null || fail "the archive is unreadable"
grep -qx 'data/db.json' "$PARTIAL.list" || fail "the archive does not contain data/db.json"

if [ "$ENCRYPT" = 1 ]; then
  age -r "$BACKUP_ENCRYPT_TO" -o "$PARTIAL.age" "$PARTIAL" >/dev/null 2>&1 || fail "age encryption failed"
  mv "$PARTIAL.age" "$ARCHIVE"
  rm -f "$PARTIAL"
else
  mv "$PARTIAL" "$ARCHIVE"
fi
chmod 600 "$ARCHIVE"
printf '%s  %s\n' "$(sha256_of "$ARCHIVE")" "$(basename "$ARCHIVE")" >"$ARCHIVE.sha256"
chmod 600 "$ARCHIVE.sha256"

size="$(human_size "$(wc -c <"$ARCHIVE" | tr -d ' ')")"
log_info "backup written: $ARCHIVE ($size)"

if [ -z "$OUT" ] && [ "$BACKUP_KEEP_DAYS" -gt 0 ]; then
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f "$old" && log_info "pruned old backup: $(basename "$old")"
  done < <(find "$DEST" -maxdepth 1 -type f -name 'opengym-*' -mtime +"$BACKUP_KEEP_DAYS" 2>/dev/null)
fi

record_backup
alert_clear backup-failed "Backup works again"
[ "$ENCRYPT" = 1 ] || [ "$QUIET" = 1 ] || info "Tip: this archive holds every user's data and the session key and is not encrypted. Set BACKUP_ENCRYPT_TO (age) before copying it off the machine."

EXIT=0
if [ -n "$BACKUP_OFFHOST_CMD" ]; then
  if sh -c "$BACKUP_OFFHOST_CMD \"\$1\"" opengym-offhost "$ARCHIVE" >/dev/null 2>&1; then
    log_info "off-host copy done"
    alert_clear backup-offhost "Off-host copy works again"
  else
    log_warn "off-host command failed: $BACKUP_OFFHOST_CMD"
    alert warn backup-offhost "openGym off-host copy failed" "BACKUP_OFFHOST_CMD failed for $(basename "$ARCHIVE"); the local archive is fine."
    EXIT=10
  fi
fi

printf '%s\n' "$ARCHIVE"
exit "$EXIT"
