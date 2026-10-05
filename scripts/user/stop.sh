#!/usr/bin/env bash
# desc: Stop openGym (data is never touched)
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"

usage() {
  cat <<'USAGE'
Usage: opengym stop [--down] [service...]

Stops the stack (or only the given services: api, web). Your data in ./data is never touched.

  --down      also remove the containers (docker compose down). Volumes and ./data are kept.
  -h, --help  this help
USAGE
}

DOWN=0 SERVICES=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --down) DOWN=1 ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; die_usage "unknown option '$1'" ;;
    *) SERVICES+=("$1") ;;
  esac
  shift
done

load_config
if ! daemon_up; then
  info "Docker is not running: nothing to stop."
  exit 0
fi
if [ "$DOWN" = 1 ]; then
  compose_cmd down || die "docker compose down failed"
elif [ "${#SERVICES[@]}" -gt 0 ]; then
  compose_cmd stop "${SERVICES[@]}" || die "docker compose stop failed"
else
  compose_cmd stop || die "docker compose stop failed"
fi
ok "openGym stopped"
