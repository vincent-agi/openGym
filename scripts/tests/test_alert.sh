#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
LIB="$REPO_ROOT/scripts/lib/alert.sh"

# al <args>: run `alert` in a fresh bash. Env (ALERT_*, OSTYPE, DISPLAY…) is inherited.
al() { "$BASH" -c '. "$0"; alert "$@"' "$LIB" "$@"; }
alc() { "$BASH" -c '. "$0"; alert_clear "$@"' "$LIB" "$@"; }
reset_env() {
  new_sandbox
  unset DISPLAY WAYLAND_DISPLAY SSH_CONNECTION GYMME_NOW MOCK_READ_STDIN OSTYPE
  export LOG_FILE="$SB/logs/gymme.log"
  export GYMME_QUIET=1
  export ALERT_DESKTOP=off
}
# PATH that has the usual tools but neither sendmail nor mail.
nomail_path() {
  mkdir -p "$SB/nomail"
  for t in date sed tr mkdir cat chmod dirname basename hostname head stat jq touch rm cp ls grep wc uname; do
    p="$(command -v "$t" 2>/dev/null || true)"
    [ -n "$p" ] && ln -sf "$p" "$SB/nomail/$t"
  done
  ln -sf "$TESTS_DIR/mocks/curl" "$SB/nomail/curl"
  cp "$TESTS_DIR/mocks/_mock.sh" "$SB/nomail/_mock.sh"
  echo "$SB/nomail"
}

# --- no channel configured: logs, returns 0
reset_env
assert_exit 0 "alert with no channel returns 0" -- al warn disk "Disk" "92% used"
assert_contains "WARN" "$(cat "$LOG_FILE")" "warn logged at WARN"
assert_contains "Disk" "$(cat "$LOG_FILE")" "title logged"
assert_contains "92% used" "$(cat "$LOG_FILE")" "message logged"
al crit k2 "Down" "api down"
assert_contains "ERROR" "$(cat "$LOG_FILE")" "crit logged at ERROR"
al info k3 "FYI" "all good"
assert_contains "INFO" "$(cat "$LOG_FILE")" "info logged at INFO"
assert_eq 0 "$(mock_calls curl)" "no webhook call without URL"

# --- usage errors
assert_exit 2 "bad level exits 2" -- al loud k t m
assert_exit 2 "missing args exits 2" -- al warn k

# --- webhook
reset_env
export ALERT_WEBHOOK_URL="https://hooks.example/x"
export MOCK_READ_STDIN=1
al warn disk 'Disk "full"' $'line1\nline2 \\ end'
assert_eq 1 "$(mock_calls curl)" "webhook called once"
call="$(grep '^curl' "$MOCK_LOG")"
assert_contains "-X POST" "$call" "POST"
assert_contains "--max-time 5" "$call" "5 s timeout"
assert_contains "Content-Type: application/json" "$call" "JSON content type"
assert_contains "https://hooks.example/x" "$call" "URL passed"
body="$(cat "$MOCK_LOG.stdin")"
assert_eq "warn" "$(printf '%s' "$body" | jq -r .level)" "json level"
assert_eq 'Disk "full"' "$(printf '%s' "$body" | jq -r .title)" "json title escaped"
assert_eq $'line1\nline2 \\ end' "$(printf '%s' "$body" | jq -r .message)" "json message escaped (newline, backslash)"
assert_contains "T" "$(printf '%s' "$body" | jq -r .time)" "json time"
assert_eq "true" "$(printf '%s' "$body" | jq 'has("host")')" "json host key"

# secrets never leave the machine
al warn leak "t" "cookie=abc123 and VAPID_KEY=zzz"
body="$(cat "$MOCK_LOG.stdin")"
assert_not_contains "abc123" "$body" "cookie value redacted in webhook"
assert_not_contains "zzz" "$body" "vapid value redacted in webhook"
assert_not_contains "abc123" "$(cat "$LOG_FILE")" "cookie value redacted in log"

# webhook failure never fails the caller
reset_env
export ALERT_WEBHOOK_URL="https://hooks.example/x"
assert_exit 0 "webhook failure still returns 0" -- env MOCK_EXIT_CURL=22 "$BASH" -c '. "$0"; alert warn k t m' "$LIB"
assert_contains "webhook" "$(cat "$LOG_FILE")" "webhook failure logged"

# --- desktop
reset_env
export ALERT_DESKTOP=auto OSTYPE=darwin23
al warn d1 "Title X" "Body Y"
assert_eq 1 "$(mock_calls osascript)" "macOS auto uses osascript"
assert_contains "display notification" "$(cat "$MOCK_LOG")" "osascript display notification"
assert_contains "Title X" "$(cat "$MOCK_LOG")" "osascript title"
SSH_CONNECTION="1 2 3 4" al warn d2 "T" "M"
assert_eq 1 "$(mock_calls osascript)" "macOS auto skipped over SSH"
export ALERT_DESKTOP=off
al warn d3 "T" "M"
assert_eq 1 "$(mock_calls osascript)" "off disables desktop"

reset_env
export ALERT_DESKTOP=auto OSTYPE=linux-gnu
al warn d4 "T" "M"
assert_eq 0 "$(mock_calls notify-send)" "linux auto skipped when headless"
DISPLAY=:0 al warn d5 "T" "M"
assert_eq 1 "$(mock_calls notify-send)" "linux auto uses notify-send with a display"
DISPLAY=:0 al crit d6 "T" "M"
assert_contains "-u critical" "$(grep notify-send "$MOCK_LOG" | tail -1)" "crit maps to critical urgency"
export ALERT_DESKTOP=on
al warn d7 "T" "M"
assert_eq 3 "$(mock_calls notify-send)" "on forces notify-send even headless"

# --- email
reset_env
export ALERT_EMAIL_TO="ops@example.com" MOCK_READ_STDIN=1
al crit m1 "Backup missing" "no backup for 3 days"
assert_eq 1 "$(mock_calls sendmail)" "sendmail used"
mailbody="$(cat "$MOCK_LOG.stdin")"
assert_contains "To: ops@example.com" "$mailbody" "mail To header"
assert_contains "Subject: [Gymme][CRIT] Backup missing" "$mailbody" "mail subject"
assert_contains "no backup for 3 days" "$mailbody" "mail body"

reset_env
export ALERT_EMAIL_TO="ops@example.com"
NP="$(nomail_path)"
PATH="$NP" "$BASH" -c '. "$0"; alert warn m2 T M; alert warn m3 T M' "$LIB" 2>/dev/null
assert_eq 1 "$(grep -c 'no mail' "$LOG_FILE")" "missing mailer warned exactly once"

# --- cooldown
reset_env
export ALERT_WEBHOOK_URL="https://hooks.example/x" ALERT_COOLDOWN=3600
export GYMME_NOW=1000000
al warn same "T" "M"
al warn same "T" "M"
assert_eq 1 "$(mock_calls curl)" "same key muted within cooldown"
al warn other "T" "M"
assert_eq 2 "$(mock_calls curl)" "different key not muted"
GYMME_NOW=1003599 al warn same "T" "M"
assert_eq 2 "$(mock_calls curl)" "still muted just before expiry"
GYMME_NOW=1003600 al warn same "T" "M"
assert_eq 3 "$(mock_calls curl)" "fires again after cooldown"
al info same-info "T" "M"
al info same-info "T" "M"
assert_eq 5 "$(mock_calls curl)" "info alerts are never muted"
export ALERT_COOLDOWN=0
al warn zero "T" "M"
al warn zero "T" "M"
assert_eq 7 "$(mock_calls curl)" "cooldown 0 disables muting"
assert_contains "same" "$(ls "$SB/.gymme-state/alerts")" "state file per key"
al warn 'weird/key name!' "T" "M"
assert_file "$SB/.gymme-state/alerts/weird_key_name_" "key sanitised for the filesystem"

# --- recovery
reset_env
export ALERT_WEBHOOK_URL="https://hooks.example/x" ALERT_COOLDOWN=3600 GYMME_NOW=2000000
al crit api-down "API down" "no answer"
assert_eq 1 "$(mock_calls curl)" "initial alert sent"
alc api-down "API is back"
assert_eq 2 "$(mock_calls curl)" "recovery sends one alert"
assert_no_file "$SB/.gymme-state/alerts/api-down" "state removed after recovery"
alc api-down "API is back"
assert_eq 2 "$(mock_calls curl)" "second clear sends nothing"
alc never-raised "nope"
assert_eq 2 "$(mock_calls curl)" "clearing an unknown key sends nothing"
al crit api-down "API down" "again"
assert_eq 3 "$(mock_calls curl)" "key can alert again after recovery"

t_summary
