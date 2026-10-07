# shellcheck shell=bash
# Helpers around the ./data directory, backups bookkeeping and small formatting utilities.

# shellcheck source=common.sh
. "${BASH_SOURCE[0]%/*}/common.sh"

json_valid() { # file
  [ -f "$1" ] || return 1
  jq empty "$1" >/dev/null 2>&1 || return 1
}

# validate_data_dir <dir>: db.json must exist and parse, every state-*.json must parse.
# Prints each problem on stdout; returns 1 when there is at least one.
validate_data_dir() { # dir
  local dir="$1" f rc=0
  if [ ! -d "$dir" ]; then
    echo "not a directory: $dir"
    return 1
  fi
  if [ ! -f "$dir/db.json" ]; then
    echo "missing db.json"
    rc=1
  elif ! json_valid "$dir/db.json"; then
    echo "invalid JSON: db.json"
    rc=1
  fi
  for f in "$dir"/state-*.json; do
    [ -e "$f" ] || continue
    if ! json_valid "$f"; then
      echo "invalid JSON: $(basename "$f")"
      rc=1
    fi
  done
  return "$rc"
}

# Number of users in <dir>/db.json; prints nothing when unreadable.
user_count() { # dir
  jq -r '.users | length' "$1/db.json" 2>/dev/null || true
}

sha256_of() { # file
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

human_size() { # bytes
  awk -v b="$1" 'BEGIN {
    if (b < 1024) printf "%d B\n", b;
    else if (b < 1048576) printf "%.1f KB\n", b / 1024;
    else if (b < 1073741824) printf "%.1f MB\n", b / 1048576;
    else printf "%.1f GB\n", b / 1073741824 }'
}

# human_age <seconds>: "just now", "N min ago", "N h ago", "N d ago".
human_age() { # seconds
  local s="$1"
  if [ "$s" -lt 60 ]; then echo "just now"
  elif [ "$s" -lt 3600 ]; then echo "$((s / 60)) min ago"
  elif [ "$s" -lt 172800 ]; then echo "$((s / 3600)) h ago"
  else echo "$((s / 86400)) d ago"
  fi
}

# Percent of the filesystem holding <path> that is used (integer, no % sign).
disk_used_pct() { # path
  df -P "$1" 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }'
}

# env_value <file> <KEY>: value of KEY in a KEY=value file (quotes stripped, "" when absent).
env_value() { # file key
  [ -f "$1" ] || return 0
  local line val
  line="$(grep -E "^[[:space:]]*$2=" "$1" 2>/dev/null | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  val="${line#*=}"
  val="${val%$'\r'}"
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  printf '%s' "$val"
}

_state_dir() { printf '%s/.gymme-state' "$GYMME_ROOT"; }

record_backup() {
  local d
  d="$(_state_dir)"
  (umask 077 && mkdir -p "$d" && printf '%s\n' "${GYMME_NOW:-$(date +%s)}" >"$d/last-backup")
}

# Epoch of the last successful backup, 0 when none was recorded.
last_backup_epoch() {
  local f v
  f="$(_state_dir)/last-backup"
  v="$(cat "$f" 2>/dev/null || true)"
  case "$v" in '' | *[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
}
