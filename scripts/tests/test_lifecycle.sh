#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export WAIT_SLEEP=0

new_sandbox

# ---------- start
assert_exit 0 "start succeeds" -- "$OG" start
assert_eq 1 "$(mock_calls 'compose up -d')" "start runs compose up -d"
assert_contains "api/health" "$(cat "$MOCK_LOG")" "start probes health"
assert_contains "http://127.0.0.1:8080" "$T_OUT" "start prints the URL"

: >"$MOCK_LOG"
assert_exit 0 "start --no-wait" -- "$OG" start --no-wait
assert_eq 0 "$(mock_calls curl)" "--no-wait skips the health probe"

: >"$MOCK_LOG"
assert_exit 1 "start fails when the daemon is down" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" start
assert_contains "Docker" "$T_OUT" "message mentions Docker"
assert_eq 0 "$(mock_calls 'compose up')" "nothing started without a daemon"

assert_exit 1 "start fails when compose up fails" -- env MOCK_EXIT_DOCKER_COMPOSE_UP=1 "$OG" start
assert_exit 1 "start fails when API never answers" -- env MOCK_EXIT_CURL=22 "$OG" start --timeout 4
assert_contains "opengym logs" "$T_OUT" "failure points to opengym logs"
assert_exit 2 "start rejects bad timeout" -- "$OG" start --timeout abc
assert_exit 2 "start rejects unknown option" -- "$OG" start --bogus
assert_exit 0 "start --help" -- "$OG" start --help
assert_contains "--no-wait" "$T_OUT" "start documents --no-wait"

BASE_URL=http://127.0.0.1:9000 assert_exit 0 "start honours BASE_URL" -- "$OG" start
assert_contains "http://127.0.0.1:9000" "$T_OUT" "custom URL printed"

# ---------- stop
: >"$MOCK_LOG"
assert_exit 0 "stop succeeds" -- "$OG" stop
assert_eq 1 "$(mock_calls 'compose stop')" "stop runs compose stop"
: >"$MOCK_LOG"
assert_exit 0 "stop one service" -- "$OG" stop api
assert_contains "compose stop api" "$(cat "$MOCK_LOG")" "service forwarded"
: >"$MOCK_LOG"
assert_exit 0 "stop --down" -- "$OG" stop --down
assert_eq 1 "$(mock_calls 'compose down')" "--down runs compose down"
assert_not_contains " -v" "$(cat "$MOCK_LOG")" "never removes volumes"
assert_exit 0 "stop with the daemon down is a no-op" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" stop
assert_exit 2 "stop rejects unknown option" -- "$OG" stop --bogus

# ---------- restart
: >"$MOCK_LOG"
assert_exit 0 "restart succeeds" -- "$OG" restart
assert_eq 1 "$(mock_calls 'compose restart')" "restart runs compose restart"
assert_eq 1 "$(mock_calls curl)" "restart waits for health"
: >"$MOCK_LOG"
assert_exit 0 "restart one service" -- "$OG" restart api
assert_contains "compose restart api" "$(cat "$MOCK_LOG")" "service forwarded"
: >"$MOCK_LOG"
assert_exit 0 "restart --no-wait" -- "$OG" restart --no-wait
assert_eq 0 "$(mock_calls curl)" "--no-wait skips the probe"
assert_exit 1 "restart fails without daemon" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" restart
assert_exit 1 "restart fails when health never returns" -- env MOCK_EXIT_CURL=22 "$OG" restart --timeout 4

t_summary
