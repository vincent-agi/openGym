#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
LIB="$REPO_ROOT/scripts/lib/common.sh"
new_sandbox

# die / die_usage
assert_exit 1 "die exits 1" -- "$BASH" -c '. "$0"; die "boom"' "$LIB"
assert_contains "boom" "$T_OUT" "die prints message"
assert_exit 2 "die_usage exits 2" -- "$BASH" -c '. "$0"; die_usage "bad flag"' "$LIB"
assert_contains "bad flag" "$T_OUT" "die_usage prints message"

# info / warn go to stderr, not stdout
out="$("$BASH" -c '. "$0"; info hello; warn careful' "$LIB" 2>/dev/null)"
assert_eq "" "$out" "info/warn write nothing on stdout"
err="$("$BASH" -c '. "$0"; info hello; warn careful' "$LIB" 2>&1 >/dev/null)"
assert_contains "hello" "$err" "info on stderr"
assert_contains "careful" "$err" "warn on stderr"

# require_cmd
assert_exit 0 "require_cmd finds bash" -- "$BASH" -c '. "$0"; require_cmd bash' "$LIB"
assert_exit 1 "require_cmd fails when missing" -- env OSTYPE=darwin23 "$BASH" -c '. "$0"; require_cmd definitely-not-a-cmd' "$LIB"
assert_contains "definitely-not-a-cmd" "$T_OUT" "require_cmd names the command"
assert_contains "brew install" "$T_OUT" "macOS hint uses brew"
assert_exit 1 "require_cmd fails on linux" -- env OSTYPE=linux-gnu "$BASH" -c '. "$0"; require_cmd definitely-not-a-cmd' "$LIB"
assert_contains "apt" "$T_OUT" "linux hint mentions apt"

# os_name
assert_eq "macos" "$(OSTYPE=darwin23 "$BASH" -c '. "$0"; os_name' "$LIB")" "os_name macos"
assert_eq "linux" "$(OSTYPE=linux-gnu "$BASH" -c '. "$0"; os_name' "$LIB")" "os_name linux"
assert_eq "other" "$(OSTYPE=freebsd14 "$BASH" -c '. "$0"; os_name' "$LIB")" "os_name other"

# confirm
assert_exit 0 "confirm accepts y" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c '. "$0"; echo y | confirm "ok?"' "$LIB"
assert_exit 0 "confirm accepts yes" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c '. "$0"; echo YES | confirm "ok?"' "$LIB"
assert_exit 1 "confirm rejects n" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c '. "$0"; echo n | confirm "ok?"' "$LIB"
assert_exit 1 "confirm rejects empty" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c '. "$0"; echo | confirm "ok?"' "$LIB"
assert_exit 0 "ASSUME_YES skips prompt" -- env ASSUME_YES=1 "$BASH" -c '. "$0"; confirm "ok?" </dev/null' "$LIB"
assert_exit 1 "confirm refuses without TTY" -- "$BASH" -c '. "$0"; echo y | confirm "ok?"' "$LIB"

# OPENGYM_ROOT
assert_eq "$SB" "$("$BASH" -c '. "$0"; echo "$OPENGYM_ROOT"' "$LIB")" "env OPENGYM_ROOT wins"
assert_eq "$REPO_ROOT" "$(cd /tmp && env -u OPENGYM_ROOT "$BASH" -c '. "$0"; echo "$OPENGYM_ROOT"' "$LIB")" "root resolved from any cwd"
mkdir -p "$SB/link"
ln -s "$LIB" "$SB/link/common.sh"
assert_eq "$REPO_ROOT" "$(env -u OPENGYM_ROOT "$BASH" -c '. "$0"; echo "$OPENGYM_ROOT"' "$SB/link/common.sh")" "root resolved through symlink"

# colours off when not a TTY or NO_COLOR
assert_eq "" "$("$BASH" -c '. "$0"; printf %s "$C_RED"' "$LIB" 2>/dev/null)" "no colour without TTY"
assert_eq "" "$(NO_COLOR=1 OPENGYM_FORCE_TTY=1 "$BASH" -c '. "$0"; printf %s "$C_RED"' "$LIB")" "NO_COLOR disables colour"

# strict mode is on after sourcing
assert_exit 1 "strict mode: unset var aborts" -- "$BASH" -c '. "$0"; echo "$undefined_var"; echo reached' "$LIB"
assert_not_contains "reached" "$T_OUT" "execution stopped at unset var"

# secure_umask
assert_eq "0077" "$("$BASH" -c '. "$0"; secure_umask; umask' "$LIB")" "secure_umask sets 077"

# run_with_timeout
assert_exit 0 "run_with_timeout passes success" -- "$BASH" -c '. "$0"; run_with_timeout 5 true' "$LIB"
assert_exit 3 "run_with_timeout passes the exit code" -- "$BASH" -c '. "$0"; run_with_timeout 5 bash -c "exit 3"' "$LIB"
start="$(date +%s)"
"$BASH" -c '. "$0"; run_with_timeout 1 sleep 8' "$LIB" >/dev/null 2>&1; rc=$?
elapsed=$(( $(date +%s) - start ))
if [ "$rc" -ne 0 ] && [ "$elapsed" -lt 5 ]; then _t_ok; else _t_fail "run_with_timeout kills a slow command (rc=$rc, ${elapsed}s)"; fi
assert_eq "hello" "$("$BASH" -c '. "$0"; run_with_timeout 5 echo hello' "$LIB")" "run_with_timeout keeps stdout"

t_summary
