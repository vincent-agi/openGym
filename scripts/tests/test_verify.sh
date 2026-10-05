#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export OPENGYM_QUIET=0

setup() { new_sandbox; use_fixture data_ok; }
run() { JSON_OUT="$("$OG" verify --json 2>/dev/null)"; RC=$?; }
st() { printf '%s' "$JSON_OUT" | jq -r --arg id "$1" '[.checks[] | select(.id == $id) | .status][0] // "absent"'; }
edit_db() { jq "$1" "$SB/data/db.json" >"$SB/db.new" && mv "$SB/db.new" "$SB/data/db.json"; }
snapshot() { (cd "$SB/data" && cat ./* | cksum); }

setup; run
assert_eq 0 "$RC" "clean data exits 0"
assert_eq '["OK"]' "$(printf '%s' "$JSON_OUT" | jq -c '[.checks[].status] | unique')" "everything OK"
before="$(snapshot)"; "$OG" verify >/dev/null 2>&1
assert_eq "$before" "$(snapshot)" "verify never modifies data/"
assert_eq "$before" "$(snapshot)" "still unchanged"

setup; echo '{}' >"$SB/data/state-uZZZZZZZZZZZZZZZ.json"; run
assert_eq 10 "$RC" "orphan state file = warning"
assert_eq WARN "$(st state-orphan)" "state-orphan WARN"
assert_contains "state-uZZZZZZZZZZZZZZZ.json" "$(printf '%s' "$JSON_OUT" | jq -r '.checks[] | select(.id=="state-orphan") | .message')" "names the file"
assert_file "$SB/data/state-uZZZZZZZZZZZZZZZ.json" "orphan is never deleted"

setup; edit_db '.creds += [{"id":"cX","userId":"ghost","publicKey":"z","counter":0}]'; run
assert_eq 20 "$RC" "credential without user = failure"
assert_eq FAIL "$(st creds-orphan)" "creds-orphan FAIL"
setup; edit_db '.users += [.users[0]]'; run
assert_eq FAIL "$(st dup-users)" "duplicate user id"
setup; edit_db '.creds += [.creds[0]]'; run
assert_eq FAIL "$(st dup-creds)" "duplicate credential id"
setup; edit_db '.subs += [{"userId":"ghost","endpoint":"e","keys":{}}]'; run
assert_eq WARN "$(st subs-orphan)" "orphan push subscription"
setup; edit_db '.invites += [{"code":"c1","usedBy":"ghost"}]'; run
assert_eq WARN "$(st invites)" "invite redeemed by a missing user"
setup; edit_db '.invites += [{"code":"c2"}]'; run
assert_eq OK "$(st invites)" "unredeemed invite is fine"
setup; edit_db '.users += [{"id":"uNoCred0000000001","name":"Zed"}]'; run
assert_eq WARN "$(st no-cred)" "user without passkey"

setup; use_fixture data_corrupt_db; run
assert_eq 20 "$RC" "corrupt db.json = failure"
assert_eq FAIL "$(st json)" "json FAIL"
assert_eq absent "$(st dup-users)" "relational checks skipped when db.json is unreadable"
setup; echo '{ x' >"$SB/data/state-uAAAAAAAAAAAAAA1.json"; run
assert_eq FAIL "$(st json)" "corrupt state file"
assert_contains "state-uAAAAAAAAAAAAAA1.json" "$(printf '%s' "$JSON_OUT" | jq -r '.checks[] | select(.id=="json") | .message')" "names the corrupt file"

# text output
setup
assert_exit 0 "text output" -- "$OG" verify
assert_contains "verdict: clean" "$T_OUT" "clean verdict"
setup; edit_db '.creds += [{"id":"cX","userId":"ghost","publicKey":"z","counter":0}]'
assert_exit 20 "text output with a failure" -- "$OG" verify
assert_contains "fix:" "$T_OUT" "hint shown"

# ---------- --backup
setup
printf 'RP_ID=localhost\nORIGIN=http://localhost:8080\n' >"$SB/.env"
A="$("$OG" backup --no-consistent --quiet 2>/dev/null | tail -1)"
echo '{"corrupt":' >"$SB/data/db.json"
live="$(snapshot)"
assert_exit 0 "verify --backup of a healthy archive" -- "$OG" verify --backup "$A"
assert_contains "$(basename "$A")" "$T_OUT" "names the archive"
assert_eq "$live" "$(snapshot)" "live data untouched by verify --backup"
left=0; for f in "$SB"/.opengym-state/verify.*; do [ -e "$f" ] && left=1; done
assert_eq 0 "$left" "temp dir removed"
printf 'x' >>"$A"
assert_exit 1 "tampered archive refused" -- "$OG" verify --backup "$A"
assert_contains "checksum" "$T_OUT" "says checksum"
setup
cp -R "$TESTS_DIR/fixtures/data_corrupt_db" "$SB/dd"; mkdir "$SB/pk"; cp -R "$SB/dd" "$SB/pk/data"
tar czf "$SB/bad.tgz" -C "$SB/pk" data
assert_exit 1 "archive with corrupt JSON refused" -- "$OG" verify --backup "$SB/bad.tgz"
assert_exit 1 "missing archive" -- "$OG" verify --backup "$SB/none.tgz"
assert_exit 2 "--backup needs a value" -- "$OG" verify --backup
rm -rf "${SB:?}/data"
assert_exit 1 "no data dir" -- "$OG" verify
assert_exit 2 "unknown option" -- "$OG" verify --bogus
assert_exit 0 "--help" -- "$OG" verify --help

t_summary
