#!/usr/bin/env bash
# desc: Start Gymme and wait until it answers
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"

usage() {
  cat <<'USAGE'
Usage: gymme start [--no-wait] [--timeout SECONDS]

Starts the stack (docker compose up -d) and waits for /api/health.
The first start downloads the exercise media (~140 MB) and can take a few minutes.

  --no-wait          do not wait for the health check
  --timeout SECONDS  health wait limit (default 120)
  -h, --help         this help
USAGE
}

WAIT=1 TIMEOUT=120
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-wait) WAIT=0 ;;
    --timeout)
      shift
      TIMEOUT="${1:-}"
      ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done
case "$TIMEOUT" in '' | *[!0-9]*) die_usage "--timeout needs a number of seconds" ;; esac

load_config
daemon_up || die "Docker is not running. Start Docker, then run: gymme start"
compose_cmd up -d || die "docker compose up failed. See: gymme logs"

if [ "$WAIT" = 1 ]; then
  info "Waiting for Gymme (up to ${TIMEOUT}s)…"
  wait_health "$BASE_URL/api/health" "$TIMEOUT" ||
    die "Gymme did not answer at $BASE_URL within ${TIMEOUT}s. Check: gymme logs"
fi
ok "Gymme is up at $BASE_URL"
[ -n "${ORIGIN:-}" ] && [ "$ORIGIN" != "$BASE_URL" ] && info "Public address (passkeys): $ORIGIN"
exit 0
