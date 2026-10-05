# shellcheck shell=bash
# Opening a backup archive safely. Used by `restore` and `verify --backup`.

# shellcheck source=data.sh
. "${BASH_SOURCE[0]%/*}/data.sh"

# archive_open <archive> <workdir> [age identity file]
# Decrypts if needed, verifies the .sha256, refuses unsafe content, extracts to <workdir>/x and validates the JSON.
# On success sets ARCHIVE_TGZ and ARCHIVE_DIR (<workdir>/x, holds data/ and maybe .env). Dies on any problem; nothing outside
# <workdir> is ever written.
archive_open() {
  local archive="$1" work="$2" identity="${3:-}" tgz expected actual entry t problems
  [ -f "$archive" ] || die "archive not found: $archive"
  require_cmd tar
  require_cmd jq

  tgz="$archive"
  case "$archive" in
    *.age)
      require_cmd age
      identity="${identity:-${BACKUP_AGE_IDENTITY:-}}"
      [ -n "$identity" ] && [ -f "$identity" ] || die "this archive is encrypted: pass --identity FILE (your age private key) or set BACKUP_AGE_IDENTITY"
      tgz="$work/archive.tgz"
      age -d -i "$identity" -o "$tgz" "$archive" >/dev/null 2>&1 || die "could not decrypt the archive with that identity"
      ;;
  esac

  if [ -f "$archive.sha256" ]; then
    expected="$(cut -d' ' -f1 "$archive.sha256")"
    actual="$(sha256_of "$archive")"
    [ "$expected" = "$actual" ] || die "checksum mismatch: the archive was modified or damaged. Nothing was changed."
  else
    warn "no $(basename "$archive").sha256 next to the archive: checksum not verified"
  fi

  tar tzf "$tgz" >"$work/list" 2>/dev/null || die "the archive is not a readable .tgz"
  tar tvzf "$tgz" 2>/dev/null | cut -c1 >"$work/types"
  while IFS= read -r entry; do
    case "$entry" in /* | ../* | */../* | */..) die "unsafe path in archive: $entry. Nothing was changed." ;; esac
    case "$entry" in
      data | data/ | data/* | .env) ;;
      *) die "unexpected path in archive: $entry. Nothing was changed." ;;
    esac
  done <"$work/list"
  while IFS= read -r t; do
    case "$t" in - | d) ;; *) die "unsupported entry type in archive (links and devices are refused). Nothing was changed." ;; esac
  done <"$work/types"

  mkdir "$work/x"
  tar xzf "$tgz" -C "$work/x" 2>/dev/null || die "could not extract the archive"
  problems="$(validate_data_dir "$work/x/data" || true)"
  if [ -n "$problems" ]; then
    printf '%s\n' "$problems" >&2
    die "the archive failed validation. Nothing was changed."
  fi
  export ARCHIVE_TGZ="$tgz"
  export ARCHIVE_DIR="$work/x"
}
