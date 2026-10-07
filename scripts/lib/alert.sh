# shellcheck shell=bash
# alert <info|warn|crit> <key> <title> <message>
#
# Always logs. Then, when configured: webhook (ALERT_WEBHOOK_URL), desktop notification
# (ALERT_DESKTOP=auto|on|off) and email (ALERT_EMAIL_TO). A channel failure only logs a warning:
# alerting never changes the exit code of the caller.
# warn/crit alerts are muted per <key> for ALERT_COOLDOWN seconds; alert_clear <key> sends one
# "recovered" info alert when a muted key goes back to normal.

# shellcheck source=log.sh
. "${BASH_SOURCE[0]%/*}/log.sh"

_alert_state_dir() { printf '%s/.gymme-state/alerts' "$GYMME_ROOT"; }
_alert_now() { printf '%s' "${GYMME_NOW:-$(date +%s)}"; }
_alert_key() { printf '%s' "$1" | tr -c 'A-Za-z0-9_.\n-' '_'; }

json_escape() { # text
  local s
  s="$(printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037')"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

_alert_host() { printf '%s' "${HOSTNAME:-$(hostname 2>/dev/null || echo unknown)}"; }

_alert_webhook() { # level title message
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  local body
  body="{\"level\":\"$1\",\"title\":\"$(json_escape "$2")\",\"message\":\"$(json_escape "$3")\",\"host\":\"$(json_escape "$(_alert_host)")\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  if ! printf '%s' "$body" | curl -fsS -X POST -H 'Content-Type: application/json' --max-time 5 --data-binary @- "$ALERT_WEBHOOK_URL" >/dev/null 2>&1; then
    log_warn "webhook alert could not be delivered"
  fi
  return 0
}

_alert_desktop() { # level title message
  local mode="${ALERT_DESKTOP:-auto}" os t m
  [ "$mode" = off ] && return 0
  os="$(os_name)"
  case "$os" in
    macos)
      if [ "$mode" = auto ] && [ -n "${SSH_CONNECTION:-}" ]; then return 0; fi
      command -v osascript >/dev/null 2>&1 || return 0
      t="${2//\\/\\\\}"; t="${t//\"/\\\"}"
      m="${3//\\/\\\\}"; m="${m//\"/\\\"}"
      osascript -e "display notification \"$m\" with title \"$t\"" >/dev/null 2>&1 ||
        log_warn "desktop notification failed"
      ;;
    linux)
      if [ "$mode" = auto ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then return 0; fi
      command -v notify-send >/dev/null 2>&1 || return 0
      local urgency=normal
      [ "$1" = crit ] && urgency=critical
      notify-send -u "$urgency" "$2" "$3" >/dev/null 2>&1 || log_warn "desktop notification failed"
      ;;
  esac
  return 0
}

_alert_email() { # level title message
  [ -n "${ALERT_EMAIL_TO:-}" ] || return 0
  local subject lvl dir marker
  lvl="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
  subject="[Gymme][$lvl] $2"
  dir="$(_alert_state_dir)"
  marker="$dir/.nomailer"
  if command -v sendmail >/dev/null 2>&1; then
    printf 'To: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s\n' "$ALERT_EMAIL_TO" "$subject" "$3" |
      sendmail -t >/dev/null 2>&1 || log_warn "email alert could not be sent"
  elif command -v mail >/dev/null 2>&1; then
    printf '%s\n' "$3" | mail -s "$subject" "$ALERT_EMAIL_TO" >/dev/null 2>&1 || log_warn "email alert could not be sent"
  elif [ ! -e "$marker" ]; then
    (umask 077 && mkdir -p "$dir" && : >"$marker") 2>/dev/null || true
    log_warn "ALERT_EMAIL_TO is set but no mail command found (install sendmail or mail); email alerts disabled"
  fi
  return 0
}

alert() { # level key title message
  [ "$#" -ge 4 ] || die_usage "alert <info|warn|crit> <key> <title> <message>"
  local level="$1" key title msg dir file now last cooldown
  case "$level" in info | warn | crit) ;; *) die_usage "alert: level must be info, warn or crit (got '$level')" ;; esac
  key="$(_alert_key "$2")"
  title="$(redact "$3")"
  msg="$(redact "$4")"

  if [ "$level" != info ]; then
    dir="$(_alert_state_dir)"
    file="$dir/$key"
    now="$(_alert_now)"
    cooldown="${ALERT_COOLDOWN:-3600}"
    if [ -f "$file" ]; then
      last="$(cat "$file" 2>/dev/null || echo 0)"
      case "$last" in '' | *[!0-9]*) last=0 ;; esac
      if [ $((now - last)) -lt "$cooldown" ]; then
        log_debug "alert $key muted (cooldown)"
        return 0
      fi
    fi
    (umask 077 && mkdir -p "$dir" && printf '%s\n' "$now" >"$file") 2>/dev/null || true
  fi

  case "$level" in
    info) log_info "$title: $msg" ;;
    warn) log_warn "$title: $msg" ;;
    crit) log_error "$title: $msg" ;;
  esac

  _alert_webhook "$level" "$title" "$msg"
  _alert_desktop "$level" "$title" "$msg"
  _alert_email "$level" "$title" "$msg"
  return 0
}

# alert_clear <key> [title]: one "recovered" info alert if <key> was alerting, then forget it.
alert_clear() { # key [title]
  [ "$#" -ge 1 ] || die_usage "alert_clear <key> [title]"
  local key file
  key="$(_alert_key "$1")"
  file="$(_alert_state_dir)/$key"
  [ -f "$file" ] || return 0
  rm -f "$file"
  alert info "${key}-recovered" "${2:-Recovered: $1}" "Back to normal: $1"
}
