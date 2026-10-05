#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export WAIT_SLEEP=0
export OPENGYM_QUIET=0

# fake docker whose API "restart" regenerates the key files, like the real API does at start
fake_docker() {
  mkdir -p "$SB/bin"
  cat >"$SB/bin/docker" <<FAKE
#!/bin/sh
echo "docker \$*" >>"$MOCK_LOG"
case "\$*" in
  "compose restart"*)
    [ -f "$SB/data/secret" ] || { echo newsecret >"$SB/data/secret"; chmod 600 "$SB/data/secret"; }
    [ -f "$SB/data/vapid.json" ] || { echo '{"publicKey":"new"}' >"$SB/data/vapid.json"; chmod 600 "$SB/data/vapid.json"; } ;;
esac
exit 0
FAKE
  chmod +x "$SB/bin/docker"
  PATH="$SB/bin:$PATH"
}
setup() {
  new_sandbox
  use_fixture data_ok
  printf 'RP_ID=localhost\nORIGIN=http://localhost:8080\n' >"$SB/.env"
  printf 'oldsecret' >"$SB/data/secret"; chmod 600 "$SB/data/secret"
  printf '{"publicKey":"old"}' >"$SB/data/vapid.json"; chmod 600 "$SB/data/vapid.json"
  export LOG_FILE="$SB/logs/opengym.log" MOCK_OUT_CURL='{"ok":true,"users":2}'
  fake_docker
}
backups_n() { local n=0 f; for f in "$SB"/backups/opengym-*.tgz; do [ -e "$f" ] && n=$((n + 1)); done; echo "$n"; }

# ---------- session
setup
assert_exit 0 "rotate session" -- "$OG" rotate-keys session --yes
assert_eq "newsecret" "$(cat "$SB/data/secret")" "secret regenerated"
assert_eq "600" "$("$BASH" -c '. "$0"; file_mode "$1"' "$REPO_ROOT/scripts/lib/common.sh" "$SB/data/secret")" "new secret mode 0600"
assert_eq "1" "$(backups_n)" "backup taken first"
A="$(ls "$SB"/backups/opengym-*.tgz)"
assert_contains "oldsecret" "$(tar xzOf "$A" data/secret)" "the backup holds the old key"
assert_contains "compose restart api" "$(cat "$MOCK_LOG")" "api restarted"
assert_contains "api/health" "$(cat "$MOCK_LOG")" "health checked"
assert_contains "signed out" "$T_OUT" "explains the impact"
assert_eq '{"publicKey":"old"}' "$(cat "$SB/data/vapid.json")" "vapid untouched by a session rotation"

# ---------- vapid
setup
assert_exit 0 "rotate vapid" -- "$OG" rotate-keys vapid --yes
assert_contains "new" "$(cat "$SB/data/vapid.json")" "vapid regenerated"
assert_eq "oldsecret" "$(cat "$SB/data/secret")" "secret untouched by a vapid rotation"
assert_contains "notifications" "$T_OUT" "explains the impact"

# ---------- safety
setup
assert_exit 0 "dry run" -- "$OG" rotate-keys session --dry-run
assert_eq "oldsecret" "$(cat "$SB/data/secret")" "dry run changes nothing"
assert_eq "0" "$(backups_n)" "dry run takes no backup"
assert_eq 0 "$(mock_calls 'compose restart')" "dry run restarts nothing"
assert_exit 1 "no TTY and no --yes aborts" -- "$OG" rotate-keys session
assert_contains "aborted" "$T_OUT" "says aborted"
assert_eq "oldsecret" "$(cat "$SB/data/secret")" "abort changes nothing"
assert_exit 0 "answering yes on a terminal" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c 'echo y | "$0" rotate-keys session' "$OG"
assert_eq "newsecret" "$(cat "$SB/data/secret")" "rotated after a yes"

setup
assert_exit 1 "failed backup aborts" -- env BACKUP_ENCRYPT_TO=age1x MOCK_EXIT_AGE=1 "$OG" rotate-keys session --yes
assert_eq "oldsecret" "$(cat "$SB/data/secret")" "key untouched when the backup fails"
assert_eq 0 "$(mock_calls 'compose restart')" "no restart when the backup fails"

# ---------- environment problems
setup; rm "$SB/bin/docker"
assert_exit 0 "docker down still rotates the file" -- env MOCK_EXIT_DOCKER_INFO=1 "$OG" rotate-keys session --yes
assert_no_file "$SB/data/secret" "old key removed"
assert_contains "opengym start" "$T_OUT" "tells how to start"
setup
assert_exit 1 "API never comes back" -- env MOCK_EXIT_CURL=22 "$OG" rotate-keys session --yes
assert_contains "does not answer" "$T_OUT" "says the API does not answer"
setup
rm "$SB/bin/docker"
assert_exit 10 "API did not create the new key" -- "$OG" rotate-keys session --yes
assert_contains "did not create" "$T_OUT" "warns about the missing key"
setup; rm "$SB/data/secret"
assert_exit 0 "nothing to rotate" -- "$OG" rotate-keys session --yes
assert_contains "nothing to rotate" "$T_OUT" "says so"
assert_eq "0" "$(backups_n)" "no backup when there is nothing to rotate"

# ---------- usage
assert_exit 2 "key required" -- "$OG" rotate-keys
assert_exit 2 "unknown key" -- "$OG" rotate-keys cookies
assert_exit 2 "two keys" -- "$OG" rotate-keys session vapid
assert_exit 2 "unknown option" -- "$OG" rotate-keys session --bogus
assert_exit 0 "--help" -- "$OG" rotate-keys --help

t_summary
