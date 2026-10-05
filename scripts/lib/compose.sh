# shellcheck shell=bash
# Docker Compose helpers: detect the CLI flavour, run it from the repo root, probe services.

# shellcheck source=common.sh
. "${BASH_SOURCE[0]%/*}/common.sh"

OG_COMPOSE=()

compose_detect() {
  [ "${#OG_COMPOSE[@]}" -gt 0 ] && return 0
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    OG_COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    OG_COMPOSE=(docker-compose)
  else
    die "Docker Compose not found. Install Docker (with the Compose plugin): https://docs.docker.com/get-docker/"
  fi
}

# Run compose from the repo root so relative paths in docker-compose.yml resolve.
compose_cmd() {
  compose_detect
  (cd "$OPENGYM_ROOT" && "${OG_COMPOSE[@]}" "$@")
}

daemon_up() { docker info >/dev/null 2>&1; }

svc_running() { # service
  local ids
  ids="$(compose_cmd ps --status running -q "$1" 2>/dev/null || true)"
  [ -n "$ids" ]
}

# Print the restart count of a service's container (0 when there is none).
svc_restart_count() { # service
  local id
  id="$(compose_cmd ps -q "$1" 2>/dev/null | head -n 1 || true)"
  if [ -z "$id" ]; then
    echo 0
    return 0
  fi
  docker inspect -f '{{.RestartCount}}' "$id" 2>/dev/null || echo 0
}

# wait_health <url> <timeout seconds>: probe every 2 s until it answers 2xx.
wait_health() { # url timeout
  local url="$1" timeout="$2" tries i
  tries=$((timeout / 2))
  [ "$tries" -ge 1 ] || tries=1
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS --max-time 3 -o /dev/null "$url" >/dev/null 2>&1; then
      return 0
    fi
    [ "$i" -lt "$tries" ] && sleep "${WAIT_SLEEP:-2}"
  done
  return 1
}

# JSON body of GET $BASE_URL/api/health (empty and non-zero when the API does not answer).
fetch_health() {
  curl -fsS --max-time 5 "${BASE_URL:-http://127.0.0.1:8080}/api/health" 2>/dev/null || return 1
}
