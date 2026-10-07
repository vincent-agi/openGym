# shellcheck shell=bash
# Minimal assertion helpers. Source from a test_*.sh file, end the file with `t_summary`.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034
REPO_ROOT="$(cd "$TESTS_DIR/../.." && pwd)"
T_PASS=0
T_FAIL=0

_t_fail() {
  T_FAIL=$((T_FAIL + 1))
  echo "  FAIL: $1" >&2
}

_t_ok() { T_PASS=$((T_PASS + 1)); }

assert_eq() { # expected actual msg
  if [ "$1" = "$2" ]; then _t_ok; else _t_fail "$3 (expected '$1', got '$2')"; fi
}

assert_contains() { # needle haystack msg
  case "$2" in *"$1"*) _t_ok ;; *) _t_fail "$3 (missing '$1' in '$2')" ;; esac
}

assert_not_contains() { # needle haystack msg
  case "$2" in *"$1"*) _t_fail "$3 (unexpected '$1' in '$2')" ;; *) _t_ok ;; esac
}

assert_file() { # path msg
  if [ -e "$1" ]; then _t_ok; else _t_fail "$2 (no such file '$1')"; fi
}

assert_no_file() { # path msg
  if [ ! -e "$1" ]; then _t_ok; else _t_fail "$2 (file exists '$1')"; fi
}

# assert_exit <code> <msg> -- <cmd...>   (stdout+stderr captured in $T_OUT)
assert_exit() {
  local want="$1" msg="$2" rc
  shift 3
  # shellcheck disable=SC2034
  T_OUT="$("$@" 2>&1)"
  rc=$?
  assert_eq "$want" "$rc" "$msg"
}

# Count lines of the mock call log that contain a pattern.
mock_calls() { # pattern
  [ -f "$MOCK_LOG" ] || { echo 0; return; }
  grep -c -- "$1" "$MOCK_LOG" || true
}

# Fresh sandbox: temp GYMME_ROOT with data/, mocks first in PATH, mock log.
new_sandbox() {
  local v
  for v in $(compgen -v | grep '^MOCK_' || true); do unset "$v"; done
  SB="$(mktemp -d)"
  export GYMME_ROOT="$SB"
  export MOCK_LOG="$SB/mock.log"
  mkdir -p "$SB/data"
  : >"$MOCK_LOG"
  PATH="$TESTS_DIR/mocks:$ORIG_PATH"
  export PATH
  unset ALERT_WEBHOOK_URL ALERT_EMAIL_TO ALERT_DESKTOP ALERT_COOLDOWN BACKUP_DIR BACKUP_KEEP_DAYS \
    BASE_URL WEB_PORT DISK_WARN_PCT DISK_CRIT_PCT STATE_WARN_KB LOG_FILE GYMME_DEBUG NO_COLOR ASSUME_YES
  # shellcheck disable=SC2154
  trap 'rm -rf "$SB"' EXIT
}

use_fixture() { # name  -> copies fixtures/<name> into $SB/data
  rm -rf "$SB/data"
  cp -R "$TESTS_DIR/fixtures/$1" "$SB/data"
}

# limited_path <tool...>: print a dir holding symlinks to only those real tools (plus the mocks
# named in MOCKS, default none). Lets a test run with a tool deliberately absent.
limited_path() {
  local d="$SB/limited" t p
  rm -rf "$d"
  mkdir -p "$d"
  for t in "$@"; do
    p="$(PATH="$ORIG_PATH" command -v "$t" 2>/dev/null || true)"
    [ -n "$p" ] && ln -sf "$p" "$d/$t"
  done
  for t in ${MOCKS:-}; do
    ln -sf "$TESTS_DIR/mocks/$t" "$d/$t"
  done
  cp "$TESTS_DIR/mocks/_mock.sh" "$d/_mock.sh"
  echo "$d"
}

ORIG_PATH="$PATH"

t_summary() {
  echo "T_RESULT $T_PASS $T_FAIL"
  [ "$T_FAIL" -eq 0 ]
}
