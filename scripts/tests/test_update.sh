#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export WAIT_SLEEP=0
export OPENGYM_QUIET=0
G() { git -C "$SB" "$@"; }

# setup [upstream]: instance with data + a git checkout; with "upstream", origin has one newer commit
setup() {
  new_sandbox
  use_fixture data_ok
  printf 'RP_ID=localhost\nORIGIN=http://localhost:8080\n' >"$SB/.env"
  export LOG_FILE="$SB/logs/opengym.log"
  export MOCK_OUT_CURL='{"ok":true,"users":2}'
  export OPENGYM_NOW=1700000000
  git init -q -b main "$SB" 2>/dev/null || { git init -q "$SB"; G checkout -q -b main; }
  G config user.email t@t.t; G config user.name t
  printf '# Changelog\n\n## 1.0.0\n- first\n' >"$SB/CHANGELOG.md"
  G add CHANGELOG.md; G commit -q -m first
  git init -q --bare "$SB/origin.git"
  G remote add origin "$SB/origin.git"; G push -q -u origin main 2>/dev/null
  OLD_SHA="$(G rev-parse HEAD)"
  if [ "${1:-}" = upstream ]; then
    git clone -q "$SB/origin.git" "$SB/other"
    git -C "$SB/other" config user.email t@t.t; git -C "$SB/other" config user.name t
    printf '# Changelog\n\n## 1.1.0\n- second feature\n\n## 1.0.0\n- first\n' >"$SB/other/CHANGELOG.md"
    git -C "$SB/other" commit -q -am second; git -C "$SB/other" push -q origin HEAD:main 2>/dev/null
  fi
  : >"$MOCK_LOG"
}
backups_count() { local n=0 f; for f in "$SB"/backups/opengym-*.tgz*; do [ -e "$f" ] && case "$f" in *.sha256) ;; *) n=$((n + 1)) ;; esac; done; echo "$n"; }

# ---------- happy path
setup upstream
assert_exit 0 "update succeeds" -- "$OG" update --yes
assert_contains "second feature" "$T_OUT" "shows the upstream changelog entry"
assert_contains "1.1.0" "$(cat "$SB/CHANGELOG.md")" "source updated (git pull)"
assert_eq 1 "$(backups_count)" "pre-update backup taken"
log="$(cat "$MOCK_LOG")"
assert_contains "compose pull" "$log" "images pulled"
assert_contains "compose up -d" "$log" "stack recreated"
assert_contains "api/health" "$log" "health checked"
assert_contains "OLD=$OLD_SHA" "OLD=$(grep '^git=' "$SB/.opengym-state/pre-update" | cut -d= -f2)" "previous commit recorded for rollback"
assert_contains "updated" "$T_OUT" "success message"

# ---------- already up to date
setup
assert_exit 0 "up to date" -- "$OG" update --yes
assert_contains "up to date" "$T_OUT" "says up to date"
assert_contains "compose pull" "$(cat "$MOCK_LOG")" "still pulls fresh images"

# ---------- dry run, confirmation, flags
setup upstream
assert_exit 0 "dry run" -- "$OG" update --dry-run
assert_contains "would" "$T_OUT" "dry run explains"
assert_eq 0 "$(mock_calls 'compose pull')" "dry run pulls nothing"
assert_eq 0 "$(backups_count)" "dry run backs up nothing"
assert_eq "$OLD_SHA" "$(G rev-parse HEAD)" "dry run leaves the checkout alone"

setup upstream
assert_exit 1 "no TTY and no --yes aborts" -- "$OG" update
assert_contains "aborted" "$T_OUT" "says aborted"
assert_eq "$OLD_SHA" "$(G rev-parse HEAD)" "abort changes nothing"
assert_eq 0 "$(backups_count)" "abort backs up nothing"

setup upstream
assert_exit 0 "--no-backup" -- "$OG" update --yes --no-backup
assert_eq 0 "$(backups_count)" "no backup with --no-backup"

setup upstream
assert_exit 0 "--no-git" -- "$OG" update --yes --no-git
assert_eq "$OLD_SHA" "$(G rev-parse HEAD)" "--no-git leaves the checkout alone"
assert_contains "compose pull" "$(cat "$MOCK_LOG")" "--no-git still updates images"

setup upstream
rm -rf "$SB/.git"
assert_exit 0 "not a git checkout" -- "$OG" update --yes
assert_contains "not a git" "$T_OUT" "explains the source is not updated"
assert_contains "compose pull" "$(cat "$MOCK_LOG")" "images still updated"

# ---------- safety: backup failure stops the update
setup upstream
assert_exit 1 "failed backup aborts" -- env BACKUP_ENCRYPT_TO=age1x MOCK_EXIT_AGE=1 "$OG" update --yes
assert_contains "--no-backup" "$T_OUT" "mentions --no-backup"
assert_eq 0 "$(mock_calls 'compose pull')" "nothing pulled after a failed backup"
assert_eq "$OLD_SHA" "$(G rev-parse HEAD)" "source untouched after a failed backup"

# ---------- git problems
setup upstream
printf 'local\n' >"$SB/local.txt"; G add local.txt; G commit -q -m local
assert_exit 1 "diverged branch refused" -- "$OG" update --yes
assert_contains "fast-forward" "$T_OUT" "explains the fast-forward failure"
assert_eq 0 "$(mock_calls 'compose up')" "stack not touched when git fails"

# ---------- docker problems
setup upstream
assert_exit 1 "docker down" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" update --yes
assert_contains "Docker" "$T_OUT" "mentions Docker"
setup upstream
assert_exit 0 "pull denied falls back to building" -- env MOCK_EXIT_DOCKER_COMPOSE_PULL=1 "$OG" update --yes
assert_contains "up -d --build" "$(cat "$MOCK_LOG")" "builds from source"
assert_contains "build" "$T_OUT" "tells the user"

# ---------- failure after the update
setup upstream
assert_exit 1 "API down after update" -- env MOCK_OUT_CURL= MOCK_EXIT_CURL=22 "$OG" update --yes --no-backup
assert_contains "$OLD_SHA" "$T_OUT" "prints the commit to go back to"
assert_contains "update failed" "$(cat "$LOG_FILE")" "failure logged"

# user count dropping is critical
setup upstream
mkdir -p "$SB/bin"
cat >"$SB/bin/curl" <<'FAKE'
#!/bin/sh
for a in "$@"; do [ "$a" = "-o" ] && exit 0; done
f="$(dirname "$0")/n"; n=$(cat "$f" 2>/dev/null || echo 0); echo $((n + 1)) >"$f"
if [ "$n" -eq 0 ]; then echo '{"ok":true,"users":3}'; else echo '{"ok":true,"users":1}'; fi
FAKE
chmod +x "$SB/bin/curl"
assert_exit 1 "user count drop fails the update" -- env PATH="$SB/bin:$PATH" "$OG" update --yes --no-backup
assert_contains "user count" "$T_OUT" "explains the drop"
assert_contains "dropped" "$(cat "$LOG_FILE")" "alert logged"

assert_exit 2 "unknown option" -- "$OG" update --bogus
assert_exit 0 "--help" -- "$OG" update --help

t_summary
