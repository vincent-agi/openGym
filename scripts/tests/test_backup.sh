#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export OPENGYM_QUIET=0

setup() {
  new_sandbox
  use_fixture data_ok
  printf 'RP_ID=localhost\nORIGIN=http://localhost:8080\n' >"$SB/.env"
  printf 'sessionsecret' >"$SB/data/secret"
  echo '{}' >"$SB/data/stray.json.tmp"
  mkdir -p "$SB/media/img" && echo img >"$SB/media/img/x.jpg"
  export LOG_FILE="$SB/logs/opengym.log"
  export OPENGYM_NOW=1700000000
}
archive_of() {
  local f
  for f in "$SB"/backups/opengym-*.tgz "$SB"/backups/opengym-*.tgz.age; do
    [ -e "$f" ] && { echo "$f"; return 0; }
  done
  return 0
}

# ---------- basic archive
setup
assert_exit 0 "backup succeeds" -- "$OG" backup --no-consistent
A="$(archive_of)"
assert_file "$A" "archive created in backups/"
assert_eq "$A" "$(printf '%s\n' "$T_OUT" | tail -1)" "stdout ends with the archive path"
list="$(tar tzf "$A")"
assert_contains "data/db.json" "$list" "contains db.json"
assert_contains "data/state-uAAAAAAAAAAAAAA1.json" "$list" "contains state files"
assert_contains "data/secret" "$list" "contains secret"
assert_contains ".env" "$list" "contains .env"
assert_not_contains "media" "$list" "excludes media"
assert_not_contains ".tmp" "$list" "excludes *.tmp"
assert_eq "600" "$("$BASH" -c '. "$0"; file_mode "$1"' "$REPO_ROOT/scripts/lib/common.sh" "$A")" "archive mode 0600"
assert_eq "700" "$("$BASH" -c '. "$0"; file_mode "$1"' "$REPO_ROOT/scripts/lib/common.sh" "$SB/backups")" "backups dir mode 0700"
assert_file "$A.sha256" "checksum file written"
want="$("$BASH" -c '. "$0"; sha256_of "$1"' "$REPO_ROOT/scripts/lib/data.sh" "$A")"
assert_contains "$want" "$(cat "$A.sha256")" "checksum matches the archive"
assert_contains "$(basename "$A")" "$(cat "$A.sha256")" "checksum names the archive"
mkdir "$SB/x" && tar xzf "$A" -C "$SB/x"
assert_eq "$(cat "$SB/data/db.json")" "$(cat "$SB/x/data/db.json")" "db.json round-trips"
assert_eq "1700000000" "$(cat "$SB/.opengym-state/last-backup")" "last backup recorded"

# unique names for backups in the same second
"$OG" backup --no-consistent >/dev/null 2>&1
assert_eq 2 "$(ls "$SB"/backups/opengym-*.tgz | wc -l | tr -d ' ')" "two backups, two files"

# ---------- consistent mode
setup
export MOCK_OUT_DOCKER_COMPOSE_PS=abc
assert_exit 0 "consistent backup" -- "$OG" backup --consistent
log="$(cat "$MOCK_LOG")"
assert_contains "compose stop api" "$log" "api stopped"
assert_contains "compose start api" "$log" "api restarted"
s="$(grep -n 'compose stop api' "$MOCK_LOG" | head -1 | cut -d: -f1)"
r="$(grep -n 'compose start api' "$MOCK_LOG" | head -1 | cut -d: -f1)"
if [ -n "$s" ] && [ -n "$r" ] && [ "$s" -lt "$r" ]; then _t_ok; else _t_fail "stop happens before start"; fi

setup; export MOCK_OUT_DOCKER_COMPOSE_PS=abc
"$OG" backup --no-consistent >/dev/null 2>&1
assert_eq 0 "$(mock_calls 'compose stop')" "--no-consistent never stops api"
setup; export MOCK_OUT_DOCKER_COMPOSE_PS=abc
"$OG" backup --quiet >/dev/null 2>&1
assert_eq 0 "$(mock_calls 'compose stop')" "--quiet defaults to a live backup"
setup; export MOCK_OUT_DOCKER_COMPOSE_PS=abc
"$OG" backup --quiet --consistent >/dev/null 2>&1
assert_eq 1 "$(mock_calls 'compose stop api')" "--quiet --consistent stops api"
setup
assert_exit 0 "consistent with docker down falls back to live" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" backup --consistent
assert_eq 0 "$(mock_calls 'compose stop')" "no stop without a daemon"
assert_contains "live" "$T_OUT" "says it did a live backup"

# api restarted even when the backup fails
setup; export MOCK_OUT_DOCKER_COMPOSE_PS=abc
assert_exit 1 "failed backup exits 1" -- env BACKUP_ENCRYPT_TO=age1x MOCK_EXIT_AGE=1 "$OG" backup --consistent
assert_contains "compose start api" "$(cat "$MOCK_LOG")" "api restarted after failure"
assert_contains "backup failed" "$(cat "$LOG_FILE")" "failure logged"
assert_eq "" "$(archive_of)" "no partial archive left behind"
assert_eq 0 "$(ls -A "$SB/backups" | wc -l | tr -d ' ')" "no hidden partial file left behind"

# ---------- encryption
setup
assert_exit 0 "encrypted backup" -- env BACKUP_ENCRYPT_TO=age1abc "$OG" backup --no-consistent
A="$(archive_of)"
case "$A" in *.tgz.age) _t_ok ;; *) _t_fail "encrypted archive ends with .tgz.age (got $A)" ;; esac
assert_eq 0 "$(ls "$SB"/backups/*.tgz 2>/dev/null | wc -l | tr -d ' ')" "plaintext archive removed"
assert_contains "-r age1abc" "$(cat "$MOCK_LOG")" "age recipient passed"
assert_contains "$(basename "$A")" "$(cat "$A.sha256")" "checksum covers the encrypted file"
assert_eq "600" "$("$BASH" -c '. "$0"; file_mode "$1"' "$REPO_ROOT/scripts/lib/common.sh" "$A")" "encrypted archive mode 0600"
setup
P="$(limited_path bash sed cut sort wc basename dirname tr head cat date mkdir)"
assert_exit 1 "encryption without age installed" -- env PATH="$P" BACKUP_ENCRYPT_TO=age1abc "$BASH" "$OG" backup --no-consistent
assert_contains "age" "$T_OUT" "message mentions age"

# ---------- retention
setup
mkdir -p "$SB/backups"
for f in opengym-2020-01-01-000000.tgz opengym-2020-01-01-000000.tgz.sha256 opengym-2020-01-01-000000.tgz.age; do
  : >"$SB/backups/$f"; touch -t 202001010000 "$SB/backups/$f"
done
: >"$SB/backups/opengym-recent.tgz"
: >"$SB/backups/notes.txt"; touch -t 202001010000 "$SB/backups/notes.txt"
"$OG" backup --no-consistent >/dev/null 2>&1
assert_no_file "$SB/backups/opengym-2020-01-01-000000.tgz" "old archive pruned"
assert_no_file "$SB/backups/opengym-2020-01-01-000000.tgz.sha256" "old checksum pruned"
assert_no_file "$SB/backups/opengym-2020-01-01-000000.tgz.age" "old encrypted archive pruned"
assert_file "$SB/backups/opengym-recent.tgz" "recent archive kept"
assert_file "$SB/backups/notes.txt" "unrelated files untouched"
assert_file "$(archive_of)" "new archive kept"
setup
mkdir -p "$SB/backups"; : >"$SB/backups/opengym-2020-01-01-000000.tgz"; touch -t 202001010000 "$SB/backups/opengym-2020-01-01-000000.tgz"
BACKUP_KEEP_DAYS=0 "$OG" backup --no-consistent >/dev/null 2>&1
assert_file "$SB/backups/opengym-2020-01-01-000000.tgz" "BACKUP_KEEP_DAYS=0 disables pruning"

# ---------- off-host hook
setup
printf '#!/bin/sh\necho "$1" >>"%s/offhost.log"\n' "$SB" >"$SB/offhost.sh"; chmod +x "$SB/offhost.sh"
BACKUP_OFFHOST_CMD="$SB/offhost.sh" "$OG" backup --no-consistent >/dev/null 2>&1
A="$(archive_of)"
assert_eq "$A" "$(cat "$SB/offhost.log")" "off-host command receives the archive path"
setup
assert_exit 10 "failing off-host hook = degraded" -- env BACKUP_OFFHOST_CMD=false "$OG" backup --no-consistent
assert_file "$(archive_of)" "archive kept when the hook fails"
assert_contains "off-host" "$(cat "$LOG_FILE")" "hook failure logged"

# ---------- errors, dry run, custom dir
setup; rm "$SB/data/db.json"
assert_exit 1 "no db.json = nothing to back up" -- "$OG" backup
assert_contains "db.json" "$T_OUT" "message names db.json"
setup
assert_exit 0 "dry run" -- "$OG" backup --dry-run
assert_no_file "$SB/backups" "dry run writes nothing"
assert_contains "would" "$T_OUT" "dry run explains the plan"
setup
assert_exit 0 "custom --out" -- "$OG" backup --no-consistent --out "$SB/elsewhere"
assert_eq 1 "$(ls "$SB"/elsewhere/opengym-*.tgz | wc -l | tr -d ' ')" "archive in custom dir"
assert_exit 2 "unknown option" -- "$OG" backup --bogus
assert_exit 0 "--help" -- "$OG" backup --help

t_summary
