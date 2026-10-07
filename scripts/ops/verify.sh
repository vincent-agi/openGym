#!/usr/bin/env bash
# desc: Read-only integrity check of data/ (or of a backup archive)
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/checks.sh
. "$_here/lib/checks.sh"
# shellcheck source=../lib/archive.sh
. "$_here/lib/archive.sh"

usage() {
  cat <<'USAGE'
Usage: gymme verify [--backup ARCHIVE [--identity FILE]] [--json]

Read-only. Checks that db.json and every state file parse, that credentials, push subscriptions and invites point at existing
users, that ids are unique, and reports state files that belong to no user. Nothing is ever repaired or deleted.
With --backup it opens the archive in a temporary folder (same safety checks as `restore`) and verifies that instead.
Exit code: 0 clean · 10 warnings · 20 failures.

  --backup ARCHIVE  verify a backup archive instead of data/
  --identity FILE   age private key for a .age archive (or BACKUP_AGE_IDENTITY)
  --json            machine-readable output
  -h, --help        this help
USAGE
}

ARCHIVE='' IDENTITY='' JSON=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup)
      shift
      ARCHIVE="${1:-}"
      [ -n "$ARCHIVE" ] || die_usage "--backup needs an archive"
      ;;
    --identity)
      shift
      IDENTITY="${1:-}"
      [ -n "$IDENTITY" ] || die_usage "--identity needs a file"
      ;;
    --json) JSON=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done

load_config
require_cmd jq
secure_umask

DIR="$GYMME_ROOT/data"
SUBJECT="data/"
if [ -n "$ARCHIVE" ]; then
  STATE="$GYMME_ROOT/.gymme-state"
  (umask 077 && mkdir -p "$STATE")
  WORK="$(mktemp -d "$STATE/verify.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT
  archive_open "$ARCHIVE" "$WORK" "$IDENTITY"
  DIR="$ARCHIVE_DIR/data"
  SUBJECT="$(basename "$ARCHIVE")"
fi
[ -d "$DIR" ] || die "no data directory to verify ($DIR)"

DB="$DIR/db.json"
list() { paste -sd' ' - | cut -c1-200; }

problems="$(validate_data_dir "$DIR" || true)"
if [ -n "$problems" ]; then
  report FAIL json "$(printf '%s' "$problems" | list)" "Restore from a backup: gymme restore <archive> (data-model.md Integrity and failure modes)"
else
  report OK json "db.json and all state files parse"
fi

if json_valid "$DB"; then
  dup="$(jq -r '.users[]?.id' "$DB" | sort | uniq -d | list)"
  if [ -n "$dup" ]; then report FAIL dup-users "duplicate user ids: $dup" "Two profiles share an id: keep one, from a backup if needed"; else report OK dup-users "user ids are unique"; fi

  dup="$(jq -r '.creds[]?.id' "$DB" | sort | uniq -d | list)"
  if [ -n "$dup" ]; then report FAIL dup-creds "duplicate credential ids: $dup" "A credential id must be unique: restore db.json from a backup"; else report OK dup-creds "credential ids are unique"; fi

  orphan="$(jq -r '[.users[]?.id] as $u | .creds[]? | select(.userId as $x | ($u | index($x)) == null) | .id' "$DB" | list)"
  if [ -n "$orphan" ]; then report FAIL creds-orphan "credentials without a user (login would answer 500): $orphan" "Remove them with the API stopped, or restore db.json from a backup"; else report OK creds-orphan "every credential has a user"; fi

  orphan="$(jq -r '[.users[]?.id] as $u | .subs[]? | select(.userId as $x | ($u | index($x)) == null) | .userId' "$DB" | sort -u | list)"
  if [ -n "$orphan" ]; then report WARN subs-orphan "push subscriptions of unknown users: $orphan" "Harmless; they are removed when delivery fails"; else report OK subs-orphan "push subscriptions all belong to a user"; fi

  orphan="$(jq -r '[.users[]?.id] as $u | .invites[]? | select(.usedBy != null) | select(.usedBy as $x | ($u | index($x)) == null) | .code' "$DB" | wc -l | tr -d ' ')"
  if [ "$orphan" -gt 0 ]; then report WARN invites "$orphan redeemed invite(s) point at a missing user" "Cosmetic; redeemed invites cannot be revoked via the API"; else report OK invites "redeemed invites point at existing users"; fi

  nocred="$(jq -r '[.creds[]?.userId] as $c | .users[]? | select(.id as $x | ($c | index($x)) == null) | .name' "$DB" | wc -l | tr -d ' ')"
  if [ "$nocred" -gt 0 ]; then report WARN no-cred "$nocred user(s) have no passkey and cannot sign in" "They must register again, or transplant a credential (data-model.md)"; else report OK no-cred "every user has a passkey"; fi

  ids="$(jq -r '.users[]?.id' "$DB")"
  strays=''
  for f in "$DIR"/state-*.json; do
    [ -e "$f" ] || continue
    uid="$(basename "$f" .json)"
    uid="${uid#state-}"
    # ids are stored sanitised in file names: compare with the same rule
    found=0
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      if [ "$(printf '%s' "$id" | tr -cd 'a-zA-Z0-9_-')" = "$uid" ]; then found=1; break; fi
    done <<<"$ids"
    [ "$found" = 1 ] || strays="$strays $(basename "$f")"
  done
  if [ -n "$strays" ]; then report WARN state-orphan "state files without a user:$strays" "Left over from a deleted profile; keep them as backup or remove by hand (never automatic)"; else report OK state-orphan "every state file belongs to a user"; fi
fi

if [ "$JSON" = 1 ]; then
  render_json
else
  echo "Gymme verify ($SUBJECT)"
  render_text
  echo
  case "$LEVEL" in
    0) printf '%sverdict: clean%s\n' "$C_GREEN" "$C_RESET" ;;
    10) printf '%sverdict: warnings%s\n' "$C_YELLOW" "$C_RESET" ;;
    *) printf '%sverdict: problems%s\n' "$C_RED" "$C_RESET" ;;
  esac
fi
exit "$LEVEL"
