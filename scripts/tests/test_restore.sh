#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export WAIT_SLEEP=0
export OPENGYM_QUIET=0

# setup: healthy instance + a fresh backup in $ARCH, then the live data is damaged
setup() {
  new_sandbox
  use_fixture data_ok
  printf 'RP_ID=localhost\nORIGIN=http://localhost:8080\n' >"$SB/.env"
  printf 'sessionsecret' >"$SB/data/secret"
  export LOG_FILE="$SB/logs/opengym.log"
  export MOCK_OUT_CURL='{"ok":true,"users":2}'
  ARCH="$("$OG" backup --no-consistent --quiet 2>/dev/null | tail -1)"
  ORIG_DB="$(cat "$SB/data/db.json")"
  : >"$MOCK_LOG"
}
damage() { cp "$TESTS_DIR/fixtures/data_corrupt_db/db.json" "$SB/data/db.json"; echo '{"x":1}' >"$SB/data/state-extra.json"; }
broken_dirs() { local d; for d in "$SB"/data.broken.*; do [ -d "$d" ] && echo "$d"; done; }
# make_tar <out.tgz> <python snippet that adds members to tar object t>
make_tar() {
  python3 - "$1" "$2" <<'PY'
import sys, tarfile, io
out, code = sys.argv[1], sys.argv[2]
t = tarfile.open(out, "w:gz")
def add(name, data=b"{}", typ=tarfile.REGTYPE, link=""):
    i = tarfile.TarInfo(name); i.size = len(data) if typ == tarfile.REGTYPE else 0
    i.type = typ; i.linkname = link
    t.addfile(i, io.BytesIO(data) if typ == tarfile.REGTYPE else None)
exec(code)
t.close()
PY
}

# ---------- happy path
setup; damage
assert_exit 0 "restore succeeds" -- "$OG" restore "$ARCH" --yes
assert_eq "$ORIG_DB" "$(cat "$SB/data/db.json")" "db.json restored"
assert_no_file "$SB/data/state-extra.json" "files absent from the backup are gone"
assert_file "$SB/data/state-uAAAAAAAAAAAAAA1.json" "state files restored"
assert_eq 1 "$(broken_dirs | wc -l | tr -d ' ')" "previous data kept as data.broken.*"
assert_contains "this is not json" "$(cat "$(broken_dirs)/db.json")" "broken data preserved intact"
assert_file "$(broken_dirs)/state-extra.json" "nothing from the old data was deleted"
log="$(cat "$MOCK_LOG")"
assert_contains "compose down" "$log" "stack stopped"
assert_contains "compose up -d" "$log" "stack restarted"
assert_contains "api/health" "$log" "health probed"
assert_contains "restored" "$T_OUT" "success message"
assert_contains "data.broken" "$T_OUT" "tells where the old data is"
assert_eq "600" "$("$BASH" -c '. "$0"; file_mode "$1"' "$REPO_ROOT/scripts/lib/common.sh" "$SB/data/secret")" "secret keeps mode 0600"
left=0; for f in "$SB"/.opengym-state/restore.*; do [ -e "$f" ] && left=1; done
assert_eq 0 "$left" "no temp dir left behind"

# ---------- user count sanity
setup; damage
assert_exit 0 "restore with different live count still succeeds" -- env MOCK_OUT_CURL='{"ok":true,"users":99}' "$OG" restore "$ARCH" --yes
assert_contains "99" "$T_OUT" "warns about the user count mismatch"

# ---------- integrity: checksum
setup; damage
printf 'x' >>"$ARCH"
assert_exit 1 "tampered archive refused" -- "$OG" restore "$ARCH" --yes
assert_contains "checksum" "$T_OUT" "says checksum"
assert_eq 0 "$(broken_dirs | wc -l | tr -d ' ')" "nothing touched after a checksum failure"
setup; damage; rm "$ARCH.sha256"
assert_exit 0 "missing checksum only warns" -- "$OG" restore "$ARCH" --yes
assert_contains "checksum" "$T_OUT" "warns about the missing checksum"

# ---------- integrity: content of the archive is validated BEFORE touching anything
setup
BAD="$SB/bad.tgz"
tar czf "$BAD" -C "$TESTS_DIR/fixtures/data_corrupt_db/.." data_corrupt_db --transform 's,^data_corrupt_db,data,' 2>/dev/null ||
  tar czf "$BAD" -s ',^data_corrupt_db,data,' -C "$TESTS_DIR/fixtures" data_corrupt_db
before="$(cat "$SB/data/db.json")"
assert_exit 1 "archive with invalid JSON refused" -- "$OG" restore "$BAD" --yes
assert_contains "db.json" "$T_OUT" "names the invalid file"
assert_eq "$before" "$(cat "$SB/data/db.json")" "live data untouched"
assert_eq 0 "$(mock_calls 'compose down')" "stack not stopped"

setup
make_tar "$SB/evil.tgz" 'add("data/db.json", b"{\"users\":[]}"); add("../evil.txt")'
assert_exit 1 "path traversal refused" -- "$OG" restore "$SB/evil.tgz" --yes
assert_contains "unsafe" "$T_OUT" "says unsafe path"
assert_no_file "$SB/../evil.txt" "nothing written outside"
make_tar "$SB/abs.tgz" 'add("data/db.json", b"{\"users\":[]}"); add("/tmp/opengym-evil")'
assert_exit 1 "absolute path refused" -- "$OG" restore "$SB/abs.tgz" --yes
make_tar "$SB/link.tgz" 'add("data/db.json", b"{\"users\":[]}"); add("data/state-link.json", typ=tarfile.SYMTYPE, link="/etc/passwd")'
assert_exit 1 "symlink refused" -- "$OG" restore "$SB/link.tgz" --yes
assert_contains "unsupported" "$T_OUT" "says unsupported entry"
make_tar "$SB/other.tgz" 'add("data/db.json", b"{\"users\":[]}"); add("etc/cron.d/x")'
assert_exit 1 "unexpected top-level path refused" -- "$OG" restore "$SB/other.tgz" --yes
assert_contains "unexpected" "$T_OUT" "says unexpected path"
make_tar "$SB/nodb.tgz" 'add("data/state-u1.json")'
assert_exit 1 "archive without db.json refused" -- "$OG" restore "$SB/nodb.tgz" --yes

# ---------- dry run and confirmation
setup; damage
assert_exit 0 "dry run" -- "$OG" restore "$ARCH" --dry-run
assert_contains "would" "$T_OUT" "dry run explains"
assert_contains "this is not json" "$(cat "$SB/data/db.json")" "dry run leaves data alone"
assert_eq 0 "$(mock_calls 'compose down')" "dry run does not stop the stack"
assert_eq 0 "$(broken_dirs | wc -l | tr -d ' ')" "dry run moves nothing"
assert_exit 1 "no TTY and no --yes aborts" -- "$OG" restore "$ARCH"
assert_contains "aborted" "$T_OUT" "says aborted"
assert_eq 0 "$(broken_dirs | wc -l | tr -d ' ')" "abort moves nothing"

# ---------- .env handling
setup; damage
printf 'RP_ID=other.example.com\nORIGIN=https://other.example.com\n' >"$SB/.env"
assert_exit 0 "restore with different RP_ID" -- "$OG" restore "$ARCH" --yes
assert_contains "RP_ID" "$T_OUT" "warns about RP_ID"
assert_contains "RP_ID=localhost" "$(cat "$SB/.env")" ".env replaced by the archive's"
saved=""; for f in "$SB"/.env.pre-restore.*; do [ -e "$f" ] && saved="$f"; done
assert_contains "other.example.com" "$(cat "$saved" 2>/dev/null)" "previous .env saved"
setup; damage; rm "$SB/.env"
make_tar "$SB/noenv.tgz" "$(printf 'add("data/db.json", b"{\\"users\\":[]}")')"
assert_exit 0 "archive without .env keeps the current one" -- "$OG" restore "$SB/noenv.tgz" --yes
assert_contains ".env" "$T_OUT" "mentions .env"

# ---------- encrypted archives
setup
EA="$(BACKUP_ENCRYPT_TO=age1x "$OG" backup --no-consistent --quiet 2>/dev/null | tail -1)"
damage
assert_exit 1 "encrypted archive needs an identity" -- "$OG" restore "$EA" --yes
assert_contains "identity" "$T_OUT" "asks for an identity"
echo "AGE-SECRET-KEY-MOCK" >"$SB/id.txt"
assert_exit 0 "restore with --identity" -- "$OG" restore "$EA" --identity "$SB/id.txt" --yes
assert_eq "$ORIG_DB" "$(cat "$SB/data/db.json")" "decrypted restore works"
assert_exit 0 "identity from BACKUP_AGE_IDENTITY" -- env BACKUP_AGE_IDENTITY="$SB/id.txt" "$OG" restore "$EA" --yes

# ---------- start / health
setup; damage
assert_exit 0 "--no-start" -- "$OG" restore "$ARCH" --yes --no-start
assert_eq 0 "$(mock_calls 'compose up')" "--no-start does not start the stack"
setup; damage
assert_exit 1 "health never returns" -- env MOCK_EXIT_CURL=22 "$OG" restore "$ARCH" --yes
assert_contains "data.broken" "$T_OUT" "gives the undo path"
assert_eq "$ORIG_DB" "$(cat "$SB/data/db.json")" "restored data stays in place for inspection"
setup; damage
assert_exit 0 "docker down still restores the files" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" restore "$ARCH" --yes
assert_eq "$ORIG_DB" "$(cat "$SB/data/db.json")" "files restored without docker"
assert_contains "opengym start" "$T_OUT" "tells how to start"

# ---------- usage
assert_exit 2 "archive argument required" -- "$OG" restore
assert_exit 1 "missing archive file" -- "$OG" restore "$SB/nope.tgz" --yes
assert_exit 2 "unknown option" -- "$OG" restore --bogus
assert_exit 0 "--help" -- "$OG" restore --help

t_summary
