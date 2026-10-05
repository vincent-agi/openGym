#!/usr/bin/env bash
# desc: Show opengym and tool versions
# Usage: opengym version
set -euo pipefail
# shellcheck source=../lib/common.sh
. "${BASH_SOURCE[0]%/*}/../lib/common.sh"

case "${1:-}" in
  -h | --help)
    echo "Usage: opengym version"
    echo "Shows the opengym version and the versions of docker compose, jq and curl (n/a when absent)."
    exit 0
    ;;
  '') ;;
  *) die_usage "version takes no arguments (got '$1')" ;;
esac

row() { printf '%-16s %s\n' "$1" "$2"; }

row opengym "$("${BASH_SOURCE[0]%/*}/../opengym" --version | cut -d' ' -f2)"

compose="n/a"
if command -v docker >/dev/null 2>&1 && v="$(docker compose version --short 2>/dev/null)" && [ -n "$v" ]; then
  compose="$v"
elif command -v docker-compose >/dev/null 2>&1 && v="$(docker-compose version --short 2>/dev/null)" && [ -n "$v" ]; then
  compose="$v"
fi
row "docker compose" "$compose"

jq_v="n/a"
command -v jq >/dev/null 2>&1 && jq_v="$(jq --version 2>/dev/null | head -n 1 || echo n/a)"
row jq "$jq_v"

curl_v="n/a"
command -v curl >/dev/null 2>&1 && curl_v="$(curl --version 2>/dev/null | head -n 1 || echo n/a)"
row curl "$curl_v"
