#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
LIB="$REPO_ROOT/scripts/lib/log.sh"
COMMON="$REPO_ROOT/scripts/lib/common.sh"

new_sandbox
export LOG_FILE="$SB/logs/sub/gymme.log"

# file_mode helper (common.sh)
touch "$SB/m" && chmod 640 "$SB/m"
assert_eq "640" "$("$BASH" -c '. "$0"; file_mode "$1"' "$COMMON" "$SB/m")" "file_mode returns octal mode"

# log_info: file line format, directory + file modes, stderr echo
err="$("$BASH" -c '. "$0"; log_info "hello world"' "$LIB" 2>&1 >/dev/null)"
assert_contains "hello world" "$err" "log_info echoes on stderr"
line="$(cat "$LOG_FILE")"
case "$line" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z\ INFO\ hello\ world) _t_ok ;;
  *) _t_fail "log line format (got '$line')" ;;
esac
assert_eq "700" "$("$BASH" -c '. "$0"; file_mode "$1"' "$COMMON" "$SB/logs/sub")" "log dir mode 0700"
assert_eq "600" "$("$BASH" -c '. "$0"; file_mode "$1"' "$COMMON" "$LOG_FILE")" "log file mode 0600"
assert_eq "" "$("$BASH" -c '. "$0"; log_info x' "$LIB" 2>/dev/null)" "log_info writes nothing on stdout"

# levels
: >"$LOG_FILE"
"$BASH" -c '. "$0"; log_warn w1; log_error e1' "$LIB" 2>/dev/null
assert_contains "WARN w1" "$(cat "$LOG_FILE")" "WARN level in file"
assert_contains "ERROR e1" "$(cat "$LOG_FILE")" "ERROR level in file"

# debug hidden unless GYMME_DEBUG=1
: >"$LOG_FILE"
"$BASH" -c '. "$0"; log_debug hidden' "$LIB" 2>/dev/null
assert_eq "" "$(cat "$LOG_FILE")" "log_debug hidden by default"
GYMME_DEBUG=1 "$BASH" -c '. "$0"; log_debug shown' "$LIB" 2>/dev/null
assert_contains "DEBUG shown" "$(cat "$LOG_FILE")" "log_debug shown with GYMME_DEBUG=1"

# quiet mode: no console output, file still written
: >"$LOG_FILE"
err="$(GYMME_QUIET=1 "$BASH" -c '. "$0"; log_warn quiet-msg' "$LIB" 2>&1)"
assert_eq "" "$err" "GYMME_QUIET silences console"
assert_contains "quiet-msg" "$(cat "$LOG_FILE")" "quiet mode still logs to file"

# no colour codes when not a TTY
err="$("$BASH" -c '. "$0"; log_error colourless' "$LIB" 2>&1 >/dev/null)"
case "$err" in *$'\033'*) _t_fail "escape codes without TTY" ;; *) _t_ok ;; esac

# redaction
r() { "$BASH" -c '. "$0"; redact "$1"' "$LIB" "$1"; }
assert_eq "cookie=***" "$(r 'cookie=abc123')" "redact cookie="
assert_eq "VAPID_PRIVATE=***" "$(r 'VAPID_PRIVATE=zzz')" "redact vapid key"
assert_eq "token: ***" "$(r 'token: abc')" "redact token with colon"
assert_eq "gymsid=***" "$(r 'gymsid=xyz')" "redact session cookie name"
assert_eq "a=1 password=*** b=2" "$(r 'a=1 password=hunter2 b=2')" "redact in the middle of a line"
assert_eq "user=bob count=3" "$(r 'user=bob count=3')" "non-sensitive text untouched"
: >"$LOG_FILE"
"$BASH" -c '. "$0"; log_info "login ok secret=topsecret"' "$LIB" 2>/dev/null
assert_not_contains "topsecret" "$(cat "$LOG_FILE")" "secret not written to log file"
err="$("$BASH" -c '. "$0"; log_info "login ok secret=topsecret"' "$LIB" 2>&1 >/dev/null)"
assert_not_contains "topsecret" "$err" "secret not echoed on console"

# default log path under the repo root
new_sandbox
unset LOG_FILE
"$BASH" -c '. "$0"; log_info dflt' "$LIB" 2>/dev/null
assert_file "$SB/logs/gymme.log" "default log location"

t_summary
