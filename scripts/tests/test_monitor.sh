#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
DATA="$REPO_ROOT/scripts/lib/data.sh"
HEALTH='{"ok":true,"users":2}'
STARTUP='api-1  | gym-api on :3000 (rpID=localhost, origin=http://localhost:8080)'

# healthy baseline
setup() {
  new_sandbox
  use_fixture data_ok
  printf 'RP_ID=localhost\nORIGIN=http://localhost:8080\n' >"$SB/.env"
  printf 'sessionsecret' >"$SB/data/secret"; chmod 600 "$SB/data/secret"
  printf '{"publicKey":"p","privateKey":"k"}' >"$SB/data/vapid.json"; chmod 600 "$SB/data/vapid.json"
  mkdir -p "$SB/media/img" && echo img >"$SB/media/img/x.jpg"
  export OPENGYM_NOW=1000000
  OPENGYM_NOW=$((1000000 - 3600)) "$BASH" -c '. "$0"; record_backup' "$DATA"
  export MOCK_OUT_DOCKER_COMPOSE_PS=abc123 MOCK_OUT_DOCKER_INSPECT=0
  export MOCK_OUT_CURL="$HEALTH"
  export MOCK_OUT_DOCKER_COMPOSE_LOGS="$STARTUP"
  export DISK_WARN_PCT=98 DISK_CRIT_PCT=100
  export ALERT_WEBHOOK_URL=https://hooks.example/x ALERT_COOLDOWN=3600 ALERT_DESKTOP=off MOCK_READ_STDIN=1
  export LOG_FILE="$SB/logs/opengym.log"
  rm -f "$SB/bin/curl"
}
# run monitor --json (alerts go to the mocks)
run() { JSON_OUT="$("$OG" monitor --json 2>/dev/null)"; RC=$?; }
st() { printf '%s' "$JSON_OUT" | jq -r --arg id "$1" '[.checks[] | select(.id == $id) | .status][0] // "absent"'; }
fake_curl() { # fail-mode: front | api
  mkdir -p "$SB/bin"
  cat >"$SB/bin/curl" <<FAKE
#!/bin/sh
for u; do :; done
case "\$u" in
  */api/health) [ "$1" = api ] && exit 22; echo '$HEALTH'; exit 0 ;;
  *) [ "$1" = front ] && exit 22; exit 0 ;;
esac
FAKE
  chmod +x "$SB/bin/curl"
  PATH="$SB/bin:$PATH"
}


posts() { grep -c 'X POST' "$MOCK_LOG" || true; }
last_body() { cat "$MOCK_LOG.stdin"; }

# ---------- healthy: silent, no alerts, state recorded
setup
assert_exit 0 "healthy monitor exits 0" -- "$OG" monitor
assert_eq "" "$T_OUT" "silent when healthy"
assert_eq 0 "$(posts)" "no alert when healthy"
assert_eq "2" "$(cat "$SB/.opengym-state/users")" "user count reference recorded"
assert_eq "0" "$(cat "$SB/.opengym-state/restarts-api")" "restart baseline recorded"
assert_exit 0 "--verbose prints OK lines" -- "$OG" monitor --verbose
assert_contains "[OK  ] docker" "$T_OUT" "verbose shows OK checks"
run
assert_eq 0 "$RC" "json run of a healthy instance exits 0"
for id in users restarts-api restarts-web push; do assert_eq OK "$(st "$id")" "extra check $id"; done

# ---------- failure: alert once, muted, then recovery
setup; export MOCK_EXIT_DOCKER_INFO=1
assert_exit 20 "docker down = 20" -- "$OG" monitor
assert_contains "[FAIL] docker" "$T_OUT" "prints the problem"
assert_contains "fix:" "$T_OUT" "prints the fix"
assert_eq 1 "$(posts)" "one alert for one failing check"
assert_eq "crit" "$(last_body | jq -r .level)" "alert level is crit"
assert_contains "docker" "$(last_body | jq -r .title)" "alert title names the check"
assert_exit 20 "second run still fails" -- "$OG" monitor
assert_eq 1 "$(posts)" "second run is muted by the cooldown"
unset MOCK_EXIT_DOCKER_INFO
assert_exit 0 "recovers" -- "$OG" monitor
assert_eq 2 "$(posts)" "one recovery notice"
assert_eq "info" "$(last_body | jq -r .level)" "recovery is an info alert"
assert_contains "recovered" "$(last_body | jq -r .title)" "recovery title"
assert_exit 0 "stays quiet after recovery" -- "$OG" monitor
assert_eq 2 "$(posts)" "no repeated recovery notice"

# ---------- warning exit code
setup; rm -f "$SB/data/secret"
assert_exit 10 "warning = 10" -- "$OG" monitor
assert_eq "warn" "$(last_body | jq -r .level)" "alert level is warn"

# ---------- restart increase since the last run
setup
"$OG" monitor >/dev/null 2>&1
export MOCK_OUT_DOCKER_INSPECT=2
assert_exit 10 "new restarts = warning" -- "$OG" monitor
assert_contains "restarted 2 time" "$T_OUT" "says how many"
assert_exit 0 "same count again is fine" -- "$OG" monitor
assert_eq "2" "$(cat "$SB/.opengym-state/restarts-api")" "baseline moves up"

# ---------- user count drop
setup
export MOCK_OUT_CURL='{"ok":true,"users":3}'
"$OG" monitor >/dev/null 2>&1
assert_eq "3" "$(cat "$SB/.opengym-state/users")" "reference is 3"
export MOCK_OUT_CURL='{"ok":true,"users":1}'
assert_exit 20 "user count fell = 20" -- "$OG" monitor
assert_contains "fell from 3 to 1" "$T_OUT" "explains the drop"
assert_contains "restore db.json" "$T_OUT" "points to the restore"
assert_eq "3" "$(cat "$SB/.opengym-state/users")" "reference is not lowered"
assert_exit 20 "keeps failing until fixed" -- "$OG" monitor
export MOCK_OUT_CURL='{"ok":true,"users":4}'
assert_exit 0 "a higher count clears it" -- "$OG" monitor
assert_eq "4" "$(cat "$SB/.opengym-state/users")" "reference moves up"
export MOCK_OUT_CURL='{"ok":true,"users":2}'
assert_exit 0 "--accept-users" -- "$OG" monitor --accept-users
assert_eq "2" "$(cat "$SB/.opengym-state/users")" "reference reset on purpose"

# ---------- push failures
setup
lines="$STARTUP"; for _ in $(seq 1 25); do lines="$lines
api-1  | push send failed uid 410 gone"; done
export MOCK_OUT_DOCKER_COMPOSE_LOGS="$lines"
assert_exit 10 "push failure spike = warning" -- "$OG" monitor
assert_contains "push" "$T_OUT" "names push"
setup
export MOCK_OUT_DOCKER_COMPOSE_LOGS="$STARTUP
api-1  | push send failed uid 410 gone"
assert_exit 0 "a few push failures are normal" -- "$OG" monitor

# ---------- --quiet
setup; export MOCK_EXIT_DOCKER_INFO=1
assert_exit 20 "--quiet keeps the exit code" -- "$OG" monitor --quiet
assert_eq "" "$T_OUT" "--quiet prints nothing"
assert_eq 1 "$(posts)" "--quiet still alerts"
assert_contains "docker" "$(cat "$LOG_FILE")" "--quiet still logs"

assert_exit 2 "unknown option" -- "$OG" monitor --bogus
assert_exit 0 "--help" -- "$OG" monitor --help

t_summary
