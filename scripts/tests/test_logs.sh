#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"

new_sandbox
LINES='api-1  | gym-api on :3000 (rpID=localhost, origin=http://localhost:8080)
api-1  | POST /api/data Error: boom
api-1  |     at handler (/app/server.js:10:5)
api-1  | push send failed abc123 410 gone
web-1  | 172.18.0.1 - - "GET / HTTP/1.1" 200 612
web-1  | 2026/10/05 21:00:00 [error] 29#29: *1 connect() failed'

assert_exit 0 "logs default" -- "$OG" logs
call="$(grep 'compose logs' "$MOCK_LOG")"
assert_contains " -f" "$call" "follows by default"
assert_contains "--tail=100" "$call" "tail 100 by default"

: >"$MOCK_LOG"
assert_exit 0 "logs api" -- "$OG" logs api
assert_contains "api" "$(grep 'compose logs' "$MOCK_LOG")" "service forwarded"
: >"$MOCK_LOG"
assert_exit 0 "logs web api" -- "$OG" logs web api
call="$(grep 'compose logs' "$MOCK_LOG")"
assert_contains "web" "$call" "first service forwarded"
assert_contains "api" "$call" "second service forwarded"

: >"$MOCK_LOG"
assert_exit 0 "--no-follow --tail" -- "$OG" logs --no-follow --tail 50
call="$(grep 'compose logs' "$MOCK_LOG")"
assert_not_contains " -f" "$call" "--no-follow does not follow"
assert_contains "--tail=50" "$call" "custom tail"

out="$(MOCK_OUT_DOCKER_COMPOSE_LOGS="$LINES" "$OG" logs --errors 2>&1)"
assert_contains "Error: boom" "$out" "--errors keeps route errors"
assert_contains "at handler" "$out" "--errors keeps stack frames"
assert_contains "push send failed" "$out" "--errors keeps push failures"
assert_contains "[error]" "$out" "--errors keeps nginx errors"
assert_not_contains "gym-api on :3000" "$out" "--errors drops the startup line"
assert_not_contains "GET / HTTP/1.1" "$out" "--errors drops access log lines"
assert_not_contains " -f" "$(grep 'compose logs' "$MOCK_LOG" | tail -1)" "--errors never follows"

assert_exit 0 "--errors with nothing to report exits 0" -- env MOCK_OUT_DOCKER_COMPOSE_LOGS="api-1  | all good" "$OG" logs --errors
assert_exit 1 "docker down" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" logs
assert_contains "Docker" "$T_OUT" "mentions Docker"
assert_exit 2 "bad tail" -- "$OG" logs --tail abc
assert_exit 2 "unknown option" -- "$OG" logs --bogus
assert_exit 0 "--help" -- "$OG" logs --help
assert_contains "--errors" "$T_OUT" "documents --errors"

t_summary
