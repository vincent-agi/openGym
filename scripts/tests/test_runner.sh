#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"

assert_eq "a" "a" "assert_eq passes on equal"
assert_contains "ell" "hello" "assert_contains passes"
assert_not_contains "z" "hello" "assert_not_contains passes"
assert_exit 3 "assert_exit sees exit code" -- bash -c 'exit 3'
assert_exit 0 "assert_exit captures output" -- bash -c 'echo boom'
assert_contains "boom" "$T_OUT" "T_OUT holds output"

new_sandbox
assert_file "$SB/data" "sandbox has data dir"
assert_eq "$SB" "$OPENGYM_ROOT" "OPENGYM_ROOT points at sandbox"
docker compose version >/dev/null
assert_eq 1 "$(mock_calls 'docker compose version')" "mock logs calls"
MOCK_EXIT_DOCKER_INFO=1 docker info >/dev/null 2>&1; rc=$?
assert_eq 1 "$rc" "mock honours MOCK_EXIT_<NAME>_<ARG1>"
out="$(MOCK_OUT_CURL=hello curl -s x)"
assert_eq "hello" "$out" "mock honours MOCK_OUT_<NAME>"

# A failing assertion must make a nested file exit non-zero and report the failure.
nested="$SB/test_nested.sh"
cat >"$nested" <<NEST
. "$TESTS_DIR/helpers.sh"
assert_eq 1 2 "deliberate failure"
t_summary
NEST
out="$(bash "$nested" 2>&1)"; rc=$?
assert_eq 1 "$rc" "failing assertion makes file exit 1"
assert_contains "T_RESULT 0 1" "$out" "failure counted"
assert_contains "deliberate failure" "$out" "failure message shown"

t_summary
