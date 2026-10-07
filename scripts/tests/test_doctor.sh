#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/gymme"
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
  export GYMME_NOW=1000000
  GYMME_NOW=$((1000000 - 3600)) "$BASH" -c '. "$0"; record_backup' "$DATA"
  export MOCK_OUT_DOCKER_COMPOSE_PS=abc123 MOCK_OUT_DOCKER_INSPECT=0
  export MOCK_OUT_CURL="$HEALTH"
  export MOCK_OUT_DOCKER_COMPOSE_LOGS="$STARTUP"
  export DISK_WARN_PCT=98 DISK_CRIT_PCT=100
  rm -f "$SB/bin/curl"
}
# run doctor --json; set RC and JSON; st <id> prints that check's status
run() { JSON_OUT="$("$OG" doctor --json 2>/dev/null)"; RC=$?; }
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

setup; run
assert_eq 0 "$RC" "healthy instance exits 0"
assert_eq '["OK"]' "$(printf '%s' "$JSON_OUT" | jq -c '[.checks[].status] | unique')" "every check is OK"
for id in docker svc-api svc-web front-door api-health data-dir db-json secret vapid tmp state-size env env-api media disk-data backup; do
  assert_eq OK "$(st "$id")" "baseline: $id"
done
assert_eq absent "$(st tls)" "no TLS check for an http origin"

# docker down
setup; export MOCK_EXIT_DOCKER_INFO=1; run
assert_eq 20 "$RC" "docker down = 20"
assert_eq FAIL "$(st docker)" "docker FAIL"
assert_eq absent "$(st svc-api)" "container checks skipped without docker"
assert_eq OK "$(st db-json)" "file checks still run without docker"

# services
setup; export MOCK_OUT_DOCKER_COMPOSE_PS=''; run
assert_eq 20 "$RC" "services down = 20"
assert_eq FAIL "$(st svc-api)" "svc-api FAIL"
assert_eq FAIL "$(st svc-web)" "svc-web FAIL"
setup; export MOCK_OUT_DOCKER_INSPECT=5; run
assert_eq 10 "$RC" "restart loop = warning"
assert_eq WARN "$(st svc-api)" "svc-api WARN on restarts"

# http
setup; fake_curl front; run
assert_eq FAIL "$(st front-door)" "front door FAIL"
assert_eq OK "$(st api-health)" "api still OK"
setup; fake_curl api; run
assert_eq FAIL "$(st api-health)" "api health FAIL"
assert_eq OK "$(st front-door)" "front door still OK"

# data files
setup; rm "$SB/data/db.json"; run
assert_eq FAIL "$(st db-json)" "missing db.json"
setup; cp "$TESTS_DIR/fixtures/data_corrupt_db/db.json" "$SB/data/db.json"; run
assert_eq FAIL "$(st db-json)" "corrupt db.json"
assert_contains "gymme restore" "$(printf '%s' "$JSON_OUT" | jq -r '.checks[] | select(.id=="db-json") | .hint')" "hint points to restore"
if [ "$(id -u)" != 0 ]; then
  setup; chmod 500 "$SB/data"; run; chmod 700 "$SB/data"
  assert_eq FAIL "$(st data-dir)" "unwritable data dir"
fi
setup; rm "$SB/data/secret"; run
assert_eq WARN "$(st secret)" "missing secret"
setup; chmod 644 "$SB/data/secret"; run
assert_eq WARN "$(st secret)" "secret with open permissions"
assert_contains "chmod 600" "$(printf '%s' "$JSON_OUT" | jq -r '.checks[] | select(.id=="secret") | .hint')" "hint says chmod 600"
setup; rm "$SB/data/vapid.json"; run
assert_eq WARN "$(st vapid)" "missing vapid.json"
setup; : >"$SB/data/old.json.tmp"; touch -t 202001010000 "$SB/data/old.json.tmp"; run
assert_eq WARN "$(st tmp)" "old stray tmp file"
setup; : >"$SB/data/new.json.tmp"; run
assert_eq OK "$(st tmp)" "fresh tmp file is normal (write in flight)"
setup; head -c 950000 /dev/zero | tr '\0' 'a' >"$SB/data/state-big.json"; run
assert_eq WARN "$(st state-size)" "state near the limit"
setup; head -c 1100000 /dev/zero | tr '\0' 'a' >"$SB/data/state-big.json"; run
assert_eq FAIL "$(st state-size)" "state over 1 MB"
assert_contains "state-big.json" "$(printf '%s' "$JSON_OUT" | jq -r '.checks[] | select(.id=="state-size") | .message')" "names the file"

# .env
setup; rm "$SB/.env"; run
assert_eq FAIL "$(st env)" "missing .env"
setup; printf 'RP_ID=gym.example.com\nORIGIN=https://other.example.com\n' >"$SB/.env"; run
assert_eq FAIL "$(st env)" "ORIGIN host differs from RP_ID"
setup; printf 'RP_ID=gym.example.com\nORIGIN=http://gym.example.com\n' >"$SB/.env"; run
assert_eq WARN "$(st env)" "plain http on a real domain"
setup; export MOCK_OUT_DOCKER_COMPOSE_LOGS='api-1  | gym-api on :3000 (rpID=old.example.com, origin=https://old.example.com)'; run
assert_eq FAIL "$(st env-api)" "running API uses a stale .env"
assert_contains "docker compose up -d" "$(printf '%s' "$JSON_OUT" | jq -r '.checks[] | select(.id=="env-api") | .hint')" "hint says reload"
setup; export MOCK_OUT_DOCKER_COMPOSE_LOGS='api-1  | something else'; run
assert_eq absent "$(st env-api)" "no startup line in logs = no verdict"

# media, disk, backup
setup; rm -rf "${SB:?}/media"; run
assert_eq WARN "$(st media)" "media missing"
setup; export DISK_WARN_PCT=0 DISK_CRIT_PCT=101; run
assert_eq WARN "$(st disk-data)" "disk over warn"
setup; export DISK_WARN_PCT=0 DISK_CRIT_PCT=1; run
assert_eq FAIL "$(st disk-data)" "disk over crit"
setup; rm -rf "$SB/.gymme-state"; run
assert_eq WARN "$(st backup)" "no backup"
setup; GYMME_NOW=$((1000000 - 100 * 3600)) "$BASH" -c '. "$0"; record_backup' "$DATA"; run
assert_eq WARN "$(st backup)" "old backup"

# TLS
fake_openssl() { # secs-valid
  mkdir -p "$SB/bin"
  cat >"$SB/bin/openssl" <<FAKE
#!/bin/sh
case "\$1" in
  s_client) [ "$1" = none ] && exit 1; echo x; exit 0 ;;
  x509)
    case "\$*" in
      *-checkend*) n=\$(echo "\$*" | sed 's/.*-checkend \([0-9]*\).*/\1/'); [ "\$n" -gt $1 ] && exit 1; exit 0 ;;
      *) echo '-----BEGIN CERTIFICATE-----'; echo MOCK; echo '-----END CERTIFICATE-----' ;;
    esac ;;
esac
FAKE
  chmod +x "$SB/bin/openssl"
  PATH="$SB/bin:$PATH"
}
https_env() { printf 'RP_ID=gym.example.com\nORIGIN=https://gym.example.com\n' >"$SB/.env"; }
setup; https_env; fake_openssl 99999999; run
assert_eq OK "$(st tls)" "valid certificate"
setup; https_env; fake_openssl $((10 * 86400)); run
assert_eq WARN "$(st tls)" "certificate expiring in 10 days"
setup; https_env; fake_openssl $((2 * 86400)); run
assert_eq FAIL "$(st tls)" "certificate expiring in 2 days"
assert_eq 20 "$RC" "expiring certificate = 20"
cat >"$SB/bin/openssl" <<'FAKE'
#!/bin/sh
exit 1
FAKE
run
assert_eq WARN "$(st tls)" "unreadable certificate"

# text output and usage
setup; export MOCK_OUT_DOCKER_COMPOSE_PS=''
assert_exit 20 "text output" -- "$OG" doctor
assert_contains "[FAIL]" "$T_OUT" "shows FAIL marker"
assert_contains "fix:" "$T_OUT" "shows fix hints"
assert_contains "verdict: problem" "$T_OUT" "shows the verdict"
setup
assert_exit 0 "healthy text output" -- "$OG" doctor
assert_contains "verdict: OK" "$T_OUT" "OK verdict"
assert_not_contains "fix:" "$T_OUT" "no hints when healthy"
assert_exit 2 "unknown option" -- "$OG" doctor --bogus
assert_exit 0 "--help" -- "$OG" doctor --help

t_summary
