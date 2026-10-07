#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
LIB="$REPO_ROOT/scripts/lib/compose.sh"
export WAIT_SLEEP=0

new_sandbox

# detection: `docker compose` preferred
"$BASH" -c '. "$0"; compose_cmd ps' "$LIB" >/dev/null 2>&1
assert_eq 1 "$(mock_calls 'docker compose ps')" "uses docker compose plugin"

# fallback to docker-compose when the plugin is missing
: >"$MOCK_LOG"
MOCK_EXIT_DOCKER_COMPOSE_VERSION=1 "$BASH" -c '. "$0"; compose_cmd ps' "$LIB" >/dev/null 2>&1
assert_eq 1 "$(mock_calls 'docker-compose ps')" "falls back to docker-compose"
assert_eq 0 "$(mock_calls 'docker compose ps')" "plugin not used when version fails"

# neither available
assert_exit 1 "no compose at all exits 1" -- env PATH=/nonexistent "$BASH" -c '. "$0"; compose_cmd ps' "$LIB"
assert_contains "Docker Compose" "$T_OUT" "message names Docker Compose"

# forwards args and runs from the repo root
mkdir -p "$SB/bin"
printf '#!/bin/sh\nif [ "$1" = compose ] && [ "$2" = version ]; then exit 0; fi\necho "cwd=$(pwd -P) args=$*"\n' >"$SB/bin/docker"
chmod +x "$SB/bin/docker"
real_sb="$(cd "$SB" && pwd -P)"
out="$(PATH="$SB/bin:$PATH" "$BASH" -c 'cd /tmp; . "$0"; compose_cmd up -d api' "$LIB")"
assert_contains "cwd=$real_sb" "$out" "compose runs from GYMME_ROOT"
assert_contains "args=compose up -d api" "$out" "args forwarded"

# daemon_up
assert_exit 0 "daemon_up true" -- "$BASH" -c '. "$0"; daemon_up' "$LIB"
assert_exit 1 "daemon_up false when docker info fails" -- env MOCK_EXIT_DOCKER_INFO=1 "$BASH" -c '. "$0"; daemon_up' "$LIB"

# svc_running
assert_exit 0 "svc_running true when ps returns an id" -- env MOCK_OUT_DOCKER_COMPOSE_PS=abc123 "$BASH" -c '. "$0"; svc_running api' "$LIB"
assert_exit 1 "svc_running false when ps is empty" -- env MOCK_OUT_DOCKER_COMPOSE_PS='' "$BASH" -c '. "$0"; svc_running api' "$LIB"
: >"$MOCK_LOG"
MOCK_OUT_DOCKER_COMPOSE_PS=abc123 "$BASH" -c '. "$0"; svc_running api' "$LIB" >/dev/null 2>&1
assert_contains "ps --status running -q api" "$(cat "$MOCK_LOG")" "svc_running filters by status and service"

# svc_restart_count
out="$(MOCK_OUT_DOCKER_COMPOSE_PS=abc123 MOCK_OUT_DOCKER_INSPECT=3 "$BASH" -c '. "$0"; svc_restart_count api' "$LIB")"
assert_eq "3" "$out" "restart count parsed"
assert_contains "inspect -f {{.RestartCount}} abc123" "$(cat "$MOCK_LOG")" "inspect called with the container id"
out="$(MOCK_OUT_DOCKER_COMPOSE_PS='' "$BASH" -c '. "$0"; svc_restart_count api' "$LIB")"
assert_eq "0" "$out" "restart count 0 when no container"

# wait_health
: >"$MOCK_LOG"
assert_exit 0 "wait_health ok on first success" -- "$BASH" -c '. "$0"; wait_health http://x/api/health 10' "$LIB"
assert_eq 1 "$(mock_calls 'curl')" "single probe when healthy"
: >"$MOCK_LOG"
assert_exit 1 "wait_health times out" -- env MOCK_EXIT_CURL=22 "$BASH" -c '. "$0"; wait_health http://x/api/health 6' "$LIB"
assert_eq 3 "$(mock_calls 'curl')" "timeout 6s = 3 probes at 2s"
assert_contains "-fsS" "$(cat "$MOCK_LOG")" "curl fails on HTTP errors"
assert_contains "http://x/api/health" "$(cat "$MOCK_LOG")" "url passed to curl"

# fetch_health
out="$(MOCK_OUT_CURL='{"ok":true,"users":3}' BASE_URL=http://h:1 "$BASH" -c '. "$0"; fetch_health' "$LIB")"
assert_eq '{"ok":true,"users":3}' "$out" "fetch_health returns the body"
assert_contains "http://h:1/api/health" "$(cat "$MOCK_LOG")" "fetch_health uses BASE_URL"
assert_exit 1 "fetch_health fails when API is down" -- env MOCK_EXIT_CURL=7 "$BASH" -c '. "$0"; fetch_health' "$LIB"

t_summary
