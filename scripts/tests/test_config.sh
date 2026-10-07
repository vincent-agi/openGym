#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
LIB="$REPO_ROOT/scripts/lib/config.sh"

# cfg <VAR>: load config in a fresh bash and print one variable
cfg() { "$BASH" -c '. "$0"; load_config; eval "printf %s \"\${$1}\""' "$LIB" "$1"; }

# --- defaults, no files at all
new_sandbox
assert_eq "$SB/backups" "$(cfg BACKUP_DIR)" "default BACKUP_DIR"
assert_eq "30" "$(cfg BACKUP_KEEP_DAYS)" "default BACKUP_KEEP_DAYS"
assert_eq "48" "$(cfg BACKUP_MAX_AGE_HOURS)" "default BACKUP_MAX_AGE_HOURS"
assert_eq "3600" "$(cfg ALERT_COOLDOWN)" "default ALERT_COOLDOWN"
assert_eq "80" "$(cfg DISK_WARN_PCT)" "default DISK_WARN_PCT"
assert_eq "92" "$(cfg DISK_CRIT_PCT)" "default DISK_CRIT_PCT"
assert_eq "900" "$(cfg STATE_WARN_KB)" "default STATE_WARN_KB"
assert_eq "auto" "$(cfg ALERT_DESKTOP)" "default ALERT_DESKTOP"
assert_eq "$SB/logs/gymme.log" "$(cfg LOG_FILE)" "default LOG_FILE"
assert_eq "http://127.0.0.1:8080" "$(cfg BASE_URL)" "default BASE_URL"
assert_eq "" "$(cfg ALERT_WEBHOOK_URL)" "webhook empty by default"

# --- precedence: env > gymme.conf > .env > default
new_sandbox
printf 'WEB_PORT=9001\n' >"$SB/.env"
assert_eq "9001" "$(cfg WEB_PORT)" ".env beats default"
assert_eq "http://127.0.0.1:9001" "$(cfg BASE_URL)" "BASE_URL follows WEB_PORT from .env"
printf 'WEB_PORT=9002\n' >"$SB/gymme.conf"
assert_eq "9002" "$(cfg WEB_PORT)" "gymme.conf beats .env"
assert_eq "9003" "$(WEB_PORT=9003 cfg WEB_PORT)" "env beats gymme.conf"
assert_eq "9002" "$(WEB_PORT='' cfg WEB_PORT)" "empty env var counts as unset"
printf 'BASE_URL=https://gym.example.com\n' >>"$SB/gymme.conf"
assert_eq "https://gym.example.com" "$(cfg BASE_URL)" "explicit BASE_URL wins over derived"

# --- .env: only API keys are read
new_sandbox
printf 'RP_ID=gym.example.com\nBACKUP_KEEP_DAYS=5\nSOMETHING_ELSE=1\n' >"$SB/.env"
assert_eq "gym.example.com" "$(cfg RP_ID)" ".env API key read"
assert_eq "30" "$(cfg BACKUP_KEEP_DAYS)" ".env script key ignored"

# --- parser is not shell: nothing executes
new_sandbox
printf 'BACKUP_DIR=$(touch %s/pwned)\nFOO=$(touch %s/pwned2)\nALERT_EMAIL_TO=`touch %s/pwned3`\n' "$SB" "$SB" "$SB" >"$SB/gymme.conf"
out="$(cfg BACKUP_DIR)"
assert_no_file "$SB/pwned" "command substitution not executed"
assert_no_file "$SB/pwned2" "unknown key not executed"
assert_no_file "$SB/pwned3" "backticks not executed"
assert_contains 'touch' "$out" "value kept literally"

# --- quotes, comments, CRLF, whitespace, export
new_sandbox
cat >"$SB/gymme.conf" <<'CONF'
# a comment
BACKUP_DIR="/a b/c" # trailing comment
ALERT_EMAIL_TO='x@y.z'
  BACKUP_KEEP_DAYS = 7
export ALERT_COOLDOWN=120
ALERT_WEBHOOK_URL=https://h.example/path#frag
CONF
printf 'DISK_WARN_PCT=70\r\n' >>"$SB/gymme.conf"
assert_eq "/a b/c" "$(cfg BACKUP_DIR)" "double quotes + trailing comment"
assert_eq "x@y.z" "$(cfg ALERT_EMAIL_TO)" "single quotes"
assert_eq "7" "$(cfg BACKUP_KEEP_DAYS)" "spaces around ="
assert_eq "120" "$(cfg ALERT_COOLDOWN)" "export prefix"
assert_eq "https://h.example/path#frag" "$(cfg ALERT_WEBHOOK_URL)" "# without space is not a comment"
assert_eq "70" "$(cfg DISK_WARN_PCT)" "CRLF stripped"

# --- relative paths resolve under the repo root
new_sandbox
printf 'BACKUP_DIR=./out/b\nLOG_FILE=l/x.log\n' >"$SB/gymme.conf"
assert_eq "$SB/out/b" "$(cfg BACKUP_DIR)" "relative ./ BACKUP_DIR"
assert_eq "$SB/l/x.log" "$(cfg LOG_FILE)" "relative LOG_FILE"

# --- validation
new_sandbox
printf 'BACKUP_KEEP_DAYS=abc\n' >"$SB/gymme.conf"
assert_exit 2 "non-numeric key exits 2" -- "$BASH" -c '. "$0"; load_config' "$LIB"
assert_contains "BACKUP_KEEP_DAYS" "$T_OUT" "error names the key"
printf 'DISK_WARN_PCT=95\nDISK_CRIT_PCT=90\n' >"$SB/gymme.conf"
assert_exit 2 "warn >= crit exits 2" -- "$BASH" -c '. "$0"; load_config' "$LIB"
assert_contains "DISK_WARN_PCT" "$T_OUT" "error names the threshold"
printf 'ALERT_DESKTOP=maybe\n' >"$SB/gymme.conf"
assert_exit 2 "bad ALERT_DESKTOP exits 2" -- "$BASH" -c '. "$0"; load_config' "$LIB"

t_summary
