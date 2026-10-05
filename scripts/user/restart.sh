#!/usr/bin/env bash
# desc: Restart openGym (or one service) and wait for health
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"

usage() {
  cat <<'USAGE'
Usage: opengym restart [--no-wait] [--timeout SECONDS] [service...]

  --no-wait          do not wait for the health check
  --timeout SECONDS  health wait limit (default 120)
  -h, --help         this help
USAGE
}

WAIT=1 TIMEOUT=120 SERVICES=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-wait) WAIT=0 ;;
    --timeout)
      shift
      TIMEOUT="${1:-}"
      ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; die_usage "unknown option '$1'" ;;
    *) SERVICES+=("$1") ;;
  esac
  shift
done
case "$TIMEOUT" in '' | *[!0-9]*) die_usage "--timeout needs a number of seconds" ;; esac

load_config
daemon_up || die "Docker is not running. Start Docker, then run: opengym start"
if [ "${#SERVICES[@]}" -gt 0 ]; then
  compose_cmd restart "${SERVICES[@]}" || die "docker compose restart failed"
else
  compose_cmd restart || die "docker compose restart failed"
fi
if [ "$WAIT" = 1 ]; then
  wait_health "$BASE_URL/api/health" "$TIMEOUT" ||
    die "openGym did not answer at $BASE_URL within ${TIMEOUT}s. Check: opengym logs"
fi
ok "openGym restarted"
