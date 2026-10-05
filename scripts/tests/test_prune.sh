#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export OPENGYM_QUIET=0

old() { touch -t 202001010000 "$@"; }
setup() {
  new_sandbox
  use_fixture data_ok
  printf 'secret' >"$SB/data/secret"
  : >"$SB/data/old.tmp"; old "$SB/data/old.tmp"
  : >"$SB/data/new.tmp"
  mkdir -p "$SB/backups"
  for f in opengym-2020-01-01-000000.tgz opengym-2020-01-01-000000.tgz.sha256; do : >"$SB/backups/$f"; old "$SB/backups/$f"; done
  : >"$SB/backups/opengym-recent.tgz"
  : >"$SB/backups/notes.txt"; old "$SB/backups/notes.txt"
  mkdir "$SB/data.broken.old" "$SB/data.broken.recent" "$SB/data.bak.old"
  echo precious >"$SB/data.broken.old/db.json"
  old "$SB/data.broken.old" "$SB/data.bak.old"
  export LOG_FILE="$SB/logs/opengym.log"
  mkdir -p "$SB/logs"
  head -c 200000 /dev/zero | tr '\0' 'l' >"$LOG_FILE"
  export LOG_MAX_KB=100
}
exists() { [ -e "$1" ]; }

# ---------- report only without a terminal
setup
assert_exit 0 "report only without a terminal" -- "$OG" prune
assert_contains "old.tmp" "$T_OUT" "lists the stale temp file"
assert_not_contains "new.tmp" "$T_OUT" "fresh temp file is not a candidate"
assert_contains "opengym-2020-01-01-000000.tgz" "$T_OUT" "lists the old backup"
assert_contains "data.broken.old" "$T_OUT" "lists the old data copy"
assert_contains "data.bak.old" "$T_OUT" "lists the old .bak copy"
assert_not_contains "data.broken.recent" "$T_OUT" "recent copy is not a candidate"
assert_contains "Log file" "$T_OUT" "mentions the oversized log"
assert_contains "--yes" "$T_OUT" "tells how to delete"
exists "$SB/data/old.tmp" && _t_ok || _t_fail "nothing deleted without --yes (tmp)"
exists "$SB/data.broken.old/db.json" && _t_ok || _t_fail "nothing deleted without --yes (data copy)"

# ---------- dry run
setup
assert_exit 0 "dry run" -- "$OG" prune --dry-run --yes
exists "$SB/data/old.tmp" && _t_ok || _t_fail "dry run keeps the tmp file"
exists "$SB/data.broken.old" && _t_ok || _t_fail "dry run keeps the data copy"
assert_contains "dry-run" "$T_OUT" "says dry-run"

# ---------- --yes
setup
assert_exit 0 "prune --yes" -- "$OG" prune --yes
exists "$SB/data/old.tmp" && _t_fail "stale tmp removed" || _t_ok
exists "$SB/data/new.tmp" && _t_ok || _t_fail "fresh tmp kept"
exists "$SB/backups/opengym-2020-01-01-000000.tgz" && _t_fail "old backup removed" || _t_ok
exists "$SB/backups/opengym-2020-01-01-000000.tgz.sha256" && _t_fail "old checksum removed" || _t_ok
exists "$SB/backups/opengym-recent.tgz" && _t_ok || _t_fail "recent backup kept"
exists "$SB/backups/notes.txt" && _t_ok || _t_fail "unrelated file in backups kept"
exists "$SB/data.broken.old" && _t_fail "old data copy removed" || _t_ok
exists "$SB/data.bak.old" && _t_fail "old .bak copy removed" || _t_ok
exists "$SB/data.broken.recent" && _t_ok || _t_fail "recent data copy kept"
exists "$SB/data/db.json" && exists "$SB/data/secret" && exists "$SB/data/state-uAAAAAAAAAAAAAA1.json" && _t_ok || _t_fail "live data files untouched"
exists "$SB/logs/opengym.log.1" && _t_ok || _t_fail "log rotated to .1"
if [ "$(wc -c <"$LOG_FILE" | tr -d ' ')" -lt 1000 ]; then _t_ok; else _t_fail "fresh small log after rotation"; fi
assert_eq "600" "$("$BASH" -c '. "$0"; file_mode "$1"' "$REPO_ROOT/scripts/lib/common.sh" "$LOG_FILE")" "new log is mode 0600"
assert_contains "nothing to prune" "$("$OG" prune --yes 2>&1)" "second run finds nothing"

# ---------- log rotation shifts older generations and caps at 5
setup
for n in 1 2 3 4 5; do echo "gen$n" >"$LOG_FILE.$n"; done
"$OG" prune --yes >/dev/null 2>&1
assert_eq "gen1" "$(cat "$LOG_FILE.2")" ".1 became .2"
assert_eq "gen4" "$(cat "$LOG_FILE.5")" ".4 became .5"
exists "$LOG_FILE.6" && _t_fail "no .6 generation" || _t_ok
setup
head -c 10000 /dev/zero | tr '\0' 'l' >"$LOG_FILE"
"$OG" prune --yes >/dev/null 2>&1
exists "$LOG_FILE.1" && _t_fail "small log not rotated" || _t_ok

# ---------- retention 0 keeps backups
setup
BACKUP_KEEP_DAYS=0 "$OG" prune --yes >/dev/null 2>&1
exists "$SB/backups/opengym-2020-01-01-000000.tgz" && _t_ok || _t_fail "BACKUP_KEEP_DAYS=0 keeps every backup"

# ---------- confirmation with a terminal
setup
assert_exit 0 "answering no" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c 'echo n | "$0" prune' "$OG"
exists "$SB/data/old.tmp" && _t_ok || _t_fail "no = nothing removed"
assert_contains "aborted" "$T_OUT" "says aborted"
assert_exit 0 "answering yes" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c 'echo y | "$0" prune' "$OG"
exists "$SB/data/old.tmp" && _t_fail "yes = removed" || _t_ok

# ---------- images
setup
"$OG" prune --yes >/dev/null 2>&1
assert_eq 0 "$(mock_calls 'image prune')" "docker is not touched without --images"
setup
"$OG" prune --yes --images >/dev/null 2>&1
assert_eq 1 "$(mock_calls 'image prune -f')" "--images prunes dangling images"
setup
"$OG" prune --images >/dev/null 2>&1
assert_eq 0 "$(mock_calls 'image prune')" "--images still needs --yes without a terminal"

# ---------- nothing to do, usage
new_sandbox; use_fixture data_ok
assert_exit 0 "clean tree" -- "$OG" prune
assert_contains "nothing to prune" "$T_OUT" "says nothing to prune"
assert_exit 2 "bad LOG_MAX_KB" -- env LOG_MAX_KB=abc "$OG" prune
assert_exit 2 "unknown option" -- "$OG" prune --bogus
assert_exit 0 "--help" -- "$OG" prune --help

t_summary
