#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/gymme"
DATA="$REPO_ROOT/scripts/lib/data.sh"

setup() { # healthy baseline: both services up, API answers, fresh backup
  new_sandbox
  use_fixture data_ok
  export GYMME_NOW=1000000
  export MOCK_OUT_DOCKER_COMPOSE_PS=abc123
  export MOCK_OUT_CURL='{"ok":true,"users":2}'
  backup_ago 3600
}
backup_ago() { GYMME_NOW=$((1000000 - $1)) "$BASH" -c '. "$0"; record_backup' "$DATA"; }

setup
assert_exit 0 "healthy instance exits 0" -- "$OG" status
assert_contains "OK" "$T_OUT" "verdict OK"
assert_contains "2 users" "$T_OUT" "user count from health"
assert_contains "1 h ago" "$T_OUT" "last backup age"
assert_contains "api" "$T_OUT" "lists api"
assert_contains "web" "$T_OUT" "lists web"

setup; rm -rf "$SB/.gymme-state"
assert_exit 10 "no backup = attention" -- "$OG" status
assert_contains "no backup" "$T_OUT" "says there is no backup"

setup; backup_ago $((60 * 3600))
assert_exit 10 "stale backup = attention" -- "$OG" status
assert_contains "older" "$T_OUT" "says backup is too old"
setup; backup_ago $((60 * 3600))
assert_exit 0 "BACKUP_MAX_AGE_HOURS raises the limit" -- env BACKUP_MAX_AGE_HOURS=100 "$OG" status

setup
assert_exit 20 "docker down = problem" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" status
assert_contains "Docker" "$T_OUT" "mentions Docker"

setup
assert_exit 20 "api not running = problem" -- env MOCK_OUT_DOCKER_COMPOSE_PS= "$OG" status
assert_contains "not running" "$T_OUT" "says not running"

setup
assert_exit 20 "health failing = problem" -- env MOCK_EXIT_CURL=22 "$OG" status
assert_contains "health" "$T_OUT" "mentions health"

setup
assert_exit 10 "disk above warn = attention" -- env DISK_WARN_PCT=0 DISK_CRIT_PCT=101 "$OG" status
assert_contains "disk" "$T_OUT" "mentions disk"
setup
assert_exit 20 "disk above crit = problem" -- env DISK_WARN_PCT=0 DISK_CRIT_PCT=1 "$OG" status

# --json
setup
assert_exit 0 "--json healthy" -- "$OG" status --json
assert_eq "ok" "$(printf '%s' "$T_OUT" | jq -r .verdict)" "json verdict"
assert_eq "2" "$(printf '%s' "$T_OUT" | jq -r .health.users)" "json users"
assert_eq "3600" "$(printf '%s' "$T_OUT" | jq -r .backup.age_seconds)" "json backup age"
assert_eq "0" "$(printf '%s' "$T_OUT" | jq -r '.issues | length')" "json no issues"
setup; rm -rf "$SB/.gymme-state"
assert_exit 10 "--json keeps exit codes" -- "$OG" status --json
assert_eq "attention" "$(printf '%s' "$T_OUT" | jq -r .verdict)" "json verdict attention"
assert_eq "null" "$(printf '%s' "$T_OUT" | jq -r .backup.age_seconds)" "json age null without backup"
assert_eq "1" "$(printf '%s' "$T_OUT" | jq -r '.issues | length')" "json lists the issue"
setup
assert_exit 20 "--json problem" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" status --json
assert_eq "problem" "$(printf '%s' "$T_OUT" | jq -r .verdict)" "json verdict problem"

assert_exit 2 "unknown option" -- "$OG" status --bogus
assert_exit 0 "--help" -- "$OG" status --help

t_summary
