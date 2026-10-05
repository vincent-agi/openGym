#!/usr/bin/env bash
# desc: Show logs (follow by default, --errors for problems only)
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"

usage() {
  cat <<'USAGE'
Usage: opengym logs [service...] [--tail N] [--no-follow] [--errors]

Shows container logs (services: api, web, media). Follows by default; press Ctrl-C to stop.

  --tail N      lines of history (default 100)
  --no-follow   print and exit
  --errors      only problems: route errors, stack frames, "push send failed", nginx [error]; implies --no-follow
  -h, --help    this help
USAGE
}

TAIL=100 FOLLOW=1 ERRORS=0 SERVICES=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tail)
      shift
      TAIL="${1:-}"
      ;;
    --no-follow) FOLLOW=0 ;;
    --errors) ERRORS=1; FOLLOW=0 ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; die_usage "unknown option '$1'" ;;
    *) SERVICES+=("$1") ;;
  esac
  shift
done
case "$TAIL" in '' | *[!0-9]*) die_usage "--tail needs a number" ;; esac

load_config
daemon_up || die "Docker is not running. Start Docker, then run: opengym logs"

ARGS=(logs)
[ "$FOLLOW" = 1 ] && ARGS+=(-f)
[ "$ERRORS" = 1 ] && ARGS+=(--no-color)
ARGS+=("--tail=$TAIL")
[ "${#SERVICES[@]}" -gt 0 ] && ARGS+=("${SERVICES[@]}")

if [ "$ERRORS" = 1 ]; then
  compose_cmd "${ARGS[@]}" 2>&1 |
    grep -E 'push send failed|Error:|\| *(GET|POST|PUT|PATCH|DELETE) /|\| +at |\[(error|crit|emerg)\]' || true
else
  rc=0
  compose_cmd "${ARGS[@]}" || rc=$?
  # 130 = Ctrl-C while following: not an error
  [ "$rc" -eq 0 ] || [ "$rc" -eq 130 ] || exit "$rc"
fi
