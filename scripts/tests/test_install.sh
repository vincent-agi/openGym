#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export OPENGYM_QUIET=0

setup() {
  new_sandbox
  cp "$REPO_ROOT/.env.example" "$SB/.env.example"
  rmdir "$SB/data"
}
mode_of() { "$BASH" -c '. "$0"; file_mode "$1"' "$REPO_ROOT/scripts/lib/common.sh" "$1"; }

# ---------- fresh install with flags
setup
assert_exit 0 "install with flags" -- "$OG" install --rp-id gym.example.com --origin https://gym.example.com --yes
assert_file "$SB/.env" ".env created"
assert_contains "RP_ID=gym.example.com" "$(cat "$SB/.env")" "RP_ID written"
assert_contains "ORIGIN=https://gym.example.com" "$(cat "$SB/.env")" "ORIGIN written"
assert_contains "RP_NAME=openGym" "$(cat "$SB/.env")" "other .env.example lines kept"
assert_eq 1 "$(grep -c '^RP_ID=' "$SB/.env")" "RP_ID appears once"
assert_eq "600" "$(mode_of "$SB/.env")" ".env mode 0600"
assert_file "$SB/data" "data/ created"
assert_file "$SB/backups" "backups/ created"
assert_eq "700" "$(mode_of "$SB/backups")" "backups/ mode 0700"
assert_contains "opengym start" "$T_OUT" "next step shown"
assert_contains "backup --quiet" "$T_OUT" "cron line for daily backup shown"
assert_contains "passkeys" "$T_OUT" "warns that RP_ID/ORIGIN are bound to passkeys"
assert_eq 0 "$(mock_calls 'compose up')" "install never starts the stack"

# ---------- defaults
setup
assert_exit 0 "install with defaults" -- "$OG" install --yes
assert_contains "RP_ID=localhost" "$(cat "$SB/.env")" "default RP_ID"
assert_contains "ORIGIN=http://localhost:8080" "$(cat "$SB/.env")" "default ORIGIN"
assert_not_contains "HTTPS" "$T_OUT" "no HTTPS warning on localhost"

# ---------- idempotent
before="$(cat "$SB/.env")"
assert_exit 0 "second run" -- "$OG" install --yes
assert_eq "$before" "$(cat "$SB/.env")" ".env untouched on re-run"
assert_contains "kept" "$T_OUT" "says it kept the existing .env"
assert_exit 2 "flags that would change an existing .env are refused" -- "$OG" install --rp-id other.example.com --origin https://other.example.com --yes
assert_contains "passkeys" "$T_OUT" "explains why"
assert_eq "$before" "$(cat "$SB/.env")" ".env still untouched"
assert_exit 0 "same values are fine" -- "$OG" install --rp-id localhost --origin http://localhost:8080 --yes

# ---------- validation
setup
assert_exit 2 "ORIGIN with a path" -- "$OG" install --rp-id gym.example.com --origin https://gym.example.com/app --yes
assert_exit 2 "RP_ID with a scheme" -- "$OG" install --rp-id https://gym.example.com --origin https://gym.example.com --yes
assert_exit 2 "RP_ID with a port" -- "$OG" install --rp-id gym.example.com:8080 --origin https://gym.example.com --yes
assert_exit 2 "ORIGIN host differs from RP_ID" -- "$OG" install --rp-id gym.example.com --origin https://other.example.com --yes
assert_contains "RP_ID" "$T_OUT" "explains the mismatch"
assert_exit 2 "ORIGIN without scheme" -- "$OG" install --rp-id gym.example.com --origin gym.example.com --yes
assert_no_file "$SB/.env" "no .env after a validation error"
assert_no_file "$SB/data" "nothing created after a validation error"
assert_exit 0 "ORIGIN with port" -- "$OG" install --rp-id localhost --origin http://localhost:9090 --yes
assert_contains "ORIGIN=http://localhost:9090" "$(cat "$SB/.env")" "port kept"
setup
assert_exit 0 "plain http on a real domain only warns" -- "$OG" install --rp-id gym.example.com --origin http://gym.example.com --yes
assert_contains "HTTPS" "$T_OUT" "warns that passkeys need HTTPS"

# ---------- interactive prompts
setup
assert_exit 0 "interactive install" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c 'printf "gym.example.com\nhttps://gym.example.com\n" | "$0" install' "$OG"
assert_contains "RP_ID=gym.example.com" "$(cat "$SB/.env")" "prompted RP_ID used"
assert_contains "ORIGIN=https://gym.example.com" "$(cat "$SB/.env")" "prompted ORIGIN used"
setup
assert_exit 0 "empty answers take the defaults" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c 'printf "\n\n" | "$0" install' "$OG"
assert_contains "RP_ID=localhost" "$(cat "$SB/.env")" "default RP_ID on empty answer"

# ---------- dependencies
setup
P="$(MOCKS="docker" limited_path bash sed cut sort wc basename dirname tr head cat date mkdir chmod cp grep tar curl)"
assert_exit 1 "missing jq" -- env PATH="$P" "$BASH" "$OG" install --yes
assert_contains "jq" "$T_OUT" "names jq"
assert_no_file "$SB/.env" "nothing created when a dependency is missing"
P="$(limited_path bash sed cut sort wc basename dirname tr head cat date mkdir chmod cp grep tar curl jq)"
assert_exit 1 "missing docker" -- env PATH="$P" "$BASH" "$OG" install --yes
assert_contains "docker" "$T_OUT" "names docker"

assert_exit 2 "unknown option" -- "$OG" install --bogus
assert_exit 0 "--help" -- "$OG" install --help

t_summary
