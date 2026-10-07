#!/usr/bin/env bash
# desc: One line shown by `gymme help` (copy this file to scripts/<suite>/<name>.sh)
#
# Standard skeleton for every gymme command. Conventions (see docs/technical/automation.md):
#   exit codes   0 OK · 1 error · 2 usage · 10 degraded/warning · 20 critical
#   flags        --help  --dry-run (any destructive action)  --yes (skip confirmation)  --json (machine output)
#   idempotent, `umask 077` for anything that may hold user data, never log secrets.
set -euo pipefail

# Works in place (scripts/TEMPLATE.sh) and once copied into scripts/<suite>/.
_here="${BASH_SOURCE[0]%/*}"
[ -f "$_here/lib/common.sh" ] || _here="$_here/.."
# shellcheck source=lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=lib/alert.sh
. "$_here/lib/alert.sh"

usage() {
  cat <<'USAGE'
Usage: gymme <command> [options]

Options:
  --dry-run   show what would change, change nothing
  --yes, -y   do not ask for confirmation
  --json      machine-readable output
  --help, -h  this help
USAGE
}

DRY_RUN=0 JSON=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --json) JSON=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done
export ASSUME_YES="${ASSUME_YES:-0}" DRY_RUN JSON

load_config
secure_umask

main() {
  if [ "$DRY_RUN" = 1 ]; then
    info "dry-run: nothing changed"
    return 0
  fi
  # Do the work here. Use log_info/log_warn/log_error, alert <level> <key> <title> <message>,
  # confirm "Really?" before destructive steps, and exit with the codes above.
  info "template: nothing to do"
}

main "$@"
