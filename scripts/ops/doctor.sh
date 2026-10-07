#!/usr/bin/env bash
# desc: Full diagnosis with a fix hint for every problem found
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/checks.sh
. "$_here/lib/checks.sh"

usage() {
  cat <<'USAGE'
Usage: gymme doctor [--json]

Runs every check (Docker, containers, front door, API, data files and permissions, .env consistency, media, stray temp
files, state file sizes, disk, backup age, TLS certificate) and prints OK / WARN / FAIL with the fix for each problem.
Exit code: 0 all OK · 10 warnings · 20 at least one failure.

  --json      machine-readable output
  -h, --help  this help
USAGE
}

JSON=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --json) JSON=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done

load_config
require_cmd jq
run_shared_checks

if [ "$JSON" = 1 ]; then
  render_json
else
  echo "Gymme doctor"
  render_text
  echo
  case "$LEVEL" in
    0) printf '%sverdict: OK%s\n' "$C_GREEN" "$C_RESET" ;;
    10) printf '%sverdict: attention%s\n' "$C_YELLOW" "$C_RESET" ;;
    *) printf '%sverdict: problem%s\n' "$C_RED" "$C_RESET" ;;
  esac
fi
exit "$LEVEL"
