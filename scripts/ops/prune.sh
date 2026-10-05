#!/usr/bin/env bash
# desc: Clean up stale temp files, old logs/backups and old data.broken.* copies
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/log.sh
. "$_here/lib/log.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"
# shellcheck source=../lib/data.sh
. "$_here/lib/data.sh"

usage() {
  cat <<'USAGE'
Usage: opengym prune [--dry-run] [--yes] [--images]

Lists, then removes:
  - data/*.tmp older than 1 hour (interrupted atomic writes; fresh ones are writes in flight)
  - backups older than BACKUP_KEEP_DAYS in BACKUP_DIR (BACKUP_KEEP_DAYS=0 keeps everything)
  - data.broken.* and data.bak.* folders older than 30 days (they hold user data: always listed first)
  - the log file when it exceeds LOG_MAX_KB (default 1024): rotated to .1 … .5
  --images  also remove dangling Docker images (docker image prune -f)

Without a terminal it only reports; deleting needs an explicit --yes. Nothing else is ever touched: db.json, state files,
secret and vapid.json are never candidates.

  --dry-run   list only
  --yes, -y   delete without asking
  -h, --help  this help
USAGE
}

DRY_RUN=0 IMAGES=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    --images) IMAGES=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done
export ASSUME_YES="${ASSUME_YES:-0}"

load_config
LOG_MAX_KB="${LOG_MAX_KB:-1024}"
case "$LOG_MAX_KB" in '' | *[!0-9]*) die_usage "LOG_MAX_KB must be a number of KB" ;; esac

TMP_FILES=() BACKUP_FILES=() OLD_DIRS=()
ROTATE_LOG=0

while IFS= read -r f; do [ -n "$f" ] && TMP_FILES+=("$f"); done < <(find "$OPENGYM_ROOT/data" -maxdepth 1 -type f -name '*.tmp' -mmin +60 2>/dev/null)
if [ "$BACKUP_KEEP_DAYS" -gt 0 ] && [ -d "$BACKUP_DIR" ]; then
  while IFS= read -r f; do [ -n "$f" ] && BACKUP_FILES+=("$f"); done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'opengym-*' -mtime +"$BACKUP_KEEP_DAYS" 2>/dev/null)
fi
while IFS= read -r d; do [ -n "$d" ] && OLD_DIRS+=("$d"); done < <(find "$OPENGYM_ROOT" -maxdepth 1 -type d \( -name 'data.broken.*' -o -name 'data.bak.*' \) -mtime +30 2>/dev/null)
if [ -f "$LOG_FILE" ] && [ "$(( $(wc -c <"$LOG_FILE" | tr -d ' ') / 1024 ))" -ge "$LOG_MAX_KB" ]; then ROTATE_LOG=1; fi

size_of() { du -sk "$1" 2>/dev/null | cut -f1; }

TOTAL=0
ITEMS=0
if [ "${#TMP_FILES[@]}" -gt 0 ]; then
  info "Stale temp files (${#TMP_FILES[@]}):"
  for f in "${TMP_FILES[@]}"; do info "  $f"; ITEMS=$((ITEMS + 1)); done
fi
if [ "${#BACKUP_FILES[@]}" -gt 0 ]; then
  info "Backups older than ${BACKUP_KEEP_DAYS} days (${#BACKUP_FILES[@]} file(s)):"
  for f in "${BACKUP_FILES[@]}"; do
    kb="$(size_of "$f")"; TOTAL=$((TOTAL + ${kb:-0})); ITEMS=$((ITEMS + 1))
    info "  $f ($(human_size $((${kb:-0} * 1024))))"
  done
fi
if [ "${#OLD_DIRS[@]}" -gt 0 ]; then
  info "Old data copies (older than 30 days, they contain user data):"
  for d in "${OLD_DIRS[@]}"; do
    kb="$(size_of "$d")"; TOTAL=$((TOTAL + ${kb:-0})); ITEMS=$((ITEMS + 1))
    info "  $d ($(human_size $((${kb:-0} * 1024))))"
  done
fi
if [ "$ROTATE_LOG" = 1 ]; then
  info "Log file over ${LOG_MAX_KB} KB: $LOG_FILE (will be rotated, nothing lost)"
  ITEMS=$((ITEMS + 1))
fi
[ "$IMAGES" = 1 ] && { info "Dangling Docker images will be removed (docker image prune -f)"; ITEMS=$((ITEMS + 1)); }

if [ "$ITEMS" -eq 0 ]; then
  ok "nothing to prune"
  exit 0
fi
info "Reclaimable: about $(human_size $((TOTAL * 1024)))"

if [ "$DRY_RUN" = 1 ]; then
  info "dry-run: nothing was removed"
  exit 0
fi
if [ "$ASSUME_YES" != 1 ] && [ ! -t 0 ] && [ "${OPENGYM_FORCE_TTY:-}" != 1 ]; then
  info "Report only (no terminal). Run again with --yes to delete."
  exit 0
fi
confirm "Remove the items above?" || { info "aborted, nothing removed"; exit 0; }

removed=0
if [ "${#TMP_FILES[@]}" -gt 0 ]; then
  for f in "${TMP_FILES[@]}"; do rm -f "$f" && removed=$((removed + 1)); done
fi
if [ "${#BACKUP_FILES[@]}" -gt 0 ]; then
  for f in "${BACKUP_FILES[@]}"; do rm -f "$f" && removed=$((removed + 1)); done
fi
if [ "${#OLD_DIRS[@]}" -gt 0 ]; then
  for d in "${OLD_DIRS[@]}"; do
    case "$d" in "$OPENGYM_ROOT"/data.broken.* | "$OPENGYM_ROOT"/data.bak.*) rm -rf "$d" && removed=$((removed + 1)) ;; esac
  done
fi
if [ "$ROTATE_LOG" = 1 ]; then
  rm -f "$LOG_FILE.5"
  for n in 4 3 2 1; do
    [ -f "$LOG_FILE.$n" ] && mv "$LOG_FILE.$n" "$LOG_FILE.$((n + 1))"
  done
  mv "$LOG_FILE" "$LOG_FILE.1"
  (umask 077 && : >"$LOG_FILE")
  removed=$((removed + 1))
fi
if [ "$IMAGES" = 1 ]; then
  if daemon_up; then docker image prune -f >/dev/null 2>&1 || warn "docker image prune failed"; else warn "Docker is not running: images not pruned"; fi
fi
log_info "prune: $removed item(s) handled"
ok "pruned $removed item(s)"
