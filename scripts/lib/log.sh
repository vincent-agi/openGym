# shellcheck shell=bash
# Levelled logging: timestamped line to LOG_FILE, plain line to stderr (silenced by OPENGYM_QUIET=1).
# Secrets are redacted before anything is written or printed.

# shellcheck source=common.sh
. "${BASH_SOURCE[0]%/*}/common.sh"

# Mask values of sensitive keys: secret, token, cookie, password, vapid, gymsid.
redact() { # text
  printf '%s' "$1" | sed -E 's/((([Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Cc][Oo][Oo][Kk][Ii][Ee]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Vv][Aa][Pp][Ii][Dd]|[Gg][Yy][Mm][Ss][Ii][Dd])[A-Za-z_]*[=:])[[:space:]]*)[^[:space:]]+/\1***/g'
}

_log() { # level message...
  local level="$1" msg file dir
  shift
  msg="$(redact "$*")"
  file="${LOG_FILE:-$OPENGYM_ROOT/logs/opengym.log}"
  dir="$(dirname "$file")"
  if [ ! -d "$dir" ]; then
    (umask 077 && mkdir -p "$dir") || true
    chmod 700 "$dir" 2>/dev/null || true
  fi
  if [ ! -e "$file" ]; then
    (umask 077 && : >"$file") 2>/dev/null || true
  fi
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$msg" >>"$file" 2>/dev/null || true
  [ "${OPENGYM_QUIET:-}" = 1 ] && return 0
  case "$level" in
    WARN) printf '%swarning:%s %s\n' "$C_YELLOW" "$C_RESET" "$msg" >&2 ;;
    ERROR) printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$msg" >&2 ;;
    *) printf '%s\n' "$msg" >&2 ;;
  esac
}

log_info() { _log INFO "$@"; }
log_warn() { _log WARN "$@"; }
log_error() { _log ERROR "$@"; }
log_debug() { [ "${OPENGYM_DEBUG:-}" = 1 ] && _log DEBUG "$@"; return 0; }
