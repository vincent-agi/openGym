# shellcheck shell=bash
# opengym configuration. Precedence: environment > opengym.conf > .env > defaults.
# Files are PARSED, never sourced: a value like $(cmd) stays a literal string.

# shellcheck source=common.sh
. "${BASH_SOURCE[0]%/*}/common.sh"

# Keys the API already uses; the only ones read from .env.
OG_API_KEYS="RP_ID ORIGIN WEB_PORT ADMIN_UIDS INVITE_ONLY"
# Script settings; they live in opengym.conf so the API never sees them.
OG_SCRIPT_KEYS="BACKUP_DIR BACKUP_KEEP_DAYS BACKUP_MAX_AGE_HOURS BACKUP_ENCRYPT_TO BACKUP_OFFHOST_CMD BASE_URL \
ALERT_WEBHOOK_URL ALERT_EMAIL_TO ALERT_DESKTOP ALERT_COOLDOWN DISK_WARN_PCT DISK_CRIT_PCT \
STATE_WARN_KB LOG_FILE"
OG_NUMERIC_KEYS="WEB_PORT BACKUP_KEEP_DAYS BACKUP_MAX_AGE_HOURS ALERT_COOLDOWN DISK_WARN_PCT DISK_CRIT_PCT STATE_WARN_KB"

# _cfg_parse <file> <allowed keys (space separated)> <var prefix>
_cfg_parse() {
  local file="$1" allow="$2" prefix="$3" line key val
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in '' | '#'*) continue ;; esac
    case "$line" in export\ *) line="${line#export }" ;; esac
    key="${line%%=*}"
    [ "$key" = "$line" ] && continue
    key="${key%"${key##*[![:space:]]}"}"
    case "$key" in '' | [0-9]* | *[!A-Z0-9_]*) continue ;; esac
    case " $allow " in *" $key "*) ;; *) continue ;; esac
    val="${line#*=}"
    val="${val#"${val%%[![:space:]]*}"}"
    case "$val" in
      \"*) val="${val#\"}"; val="${val%%\"*}" ;;
      \'*) val="${val#\'}"; val="${val%%\'*}" ;;
      *) val="${val%% \#*}"; val="${val%"${val##*[![:space:]]}"}" ;;
    esac
    printf -v "${prefix}${key}" '%s' "$val"
  done <"$file"
}

# Make a path absolute under the repo root when it is relative.
_cfg_abs() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    ./*) printf '%s/%s' "$OPENGYM_ROOT" "${1#./}" ;;
    *) printf '%s/%s' "$OPENGYM_ROOT" "$1" ;;
  esac
}

load_config() {
  local k cur c e
  _cfg_parse "$OPENGYM_ROOT/.env" "$OG_API_KEYS" _DOTENV_
  _cfg_parse "$OPENGYM_ROOT/opengym.conf" "$OG_API_KEYS $OG_SCRIPT_KEYS" _CONF_

  for k in $OG_API_KEYS $OG_SCRIPT_KEYS; do
    cur="${!k:-}"
    if [ -z "$cur" ]; then
      c="_CONF_$k"
      e="_DOTENV_$k"
      cur="${!c:-}"
      [ -z "$cur" ] && cur="${!e:-}"
    fi
    printf -v "$k" '%s' "$cur"
  done

  : "${WEB_PORT:=8080}"
  : "${BACKUP_KEEP_DAYS:=30}"
  : "${BACKUP_MAX_AGE_HOURS:=48}"
  : "${ALERT_COOLDOWN:=3600}"
  : "${DISK_WARN_PCT:=80}"
  : "${DISK_CRIT_PCT:=92}"
  : "${STATE_WARN_KB:=900}"
  : "${ALERT_DESKTOP:=auto}"
  : "${BASE_URL:=http://127.0.0.1:${WEB_PORT}}"
  [ -n "$BACKUP_DIR" ] || BACKUP_DIR="backups"
  [ -n "$LOG_FILE" ] || LOG_FILE="logs/opengym.log"
  BACKUP_DIR="$(_cfg_abs "$BACKUP_DIR")"
  LOG_FILE="$(_cfg_abs "$LOG_FILE")"

  for k in $OG_NUMERIC_KEYS; do
    case "${!k}" in
      '' | *[!0-9]*) die_usage "$k must be a non-negative integer (got '${!k}')" ;;
    esac
  done
  [ "$DISK_WARN_PCT" -lt "$DISK_CRIT_PCT" ] || die_usage "DISK_WARN_PCT ($DISK_WARN_PCT) must be lower than DISK_CRIT_PCT ($DISK_CRIT_PCT)"
  case "$ALERT_DESKTOP" in
    auto | on | off) ;;
    *) die_usage "ALERT_DESKTOP must be auto, on or off (got '$ALERT_DESKTOP')" ;;
  esac

  # shellcheck disable=SC2086,SC2163
  export $OG_API_KEYS $OG_SCRIPT_KEYS
}
