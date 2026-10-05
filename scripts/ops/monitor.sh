#!/usr/bin/env bash
# desc: Cron-friendly watchdog: silent when healthy, alerts when not
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/alert.sh
. "$_here/lib/alert.sh"
# shellcheck source=../lib/checks.sh
. "$_here/lib/checks.sh"

usage() {
  cat <<'USAGE'
Usage: opengym monitor [--quiet] [--verbose] [--json] [--accept-users]

Runs the same checks as `doctor` plus: a fall in the user count (the signature of a db.json reset), container restarts since the
last run, and a spike of push failures. Prints only what is wrong. Each problem raises an alert (log, webhook, desktop, email as
configured) muted for ALERT_COOLDOWN; a recovery notice is sent when it clears.
Exit code: 0 healthy · 10 warnings · 20 failures. Suggested cron: every 15 minutes (`opengym schedule install`).

  --quiet         print nothing (alerts and the log still happen)
  --verbose       also print the checks that are OK
  --json          machine-readable output (all checks)
  --accept-users  accept the current user count as the new reference (after a deliberate change)
  -h, --help      this help
USAGE
}

QUIET=0 VERBOSE=0 JSON=0 ACCEPT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --quiet) QUIET=1 ;;
    --verbose) VERBOSE=1 ;;
    --json) JSON=1 ;;
    --accept-users) ACCEPT=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done

load_config
require_cmd jq
secure_umask
STATE="$OPENGYM_ROOT/.opengym-state"
(umask 077 && mkdir -p "$STATE")
PUSH_FAIL_WARN=20

read_state() { # name -> value or empty
  local v
  v="$(cat "$STATE/$1" 2>/dev/null || true)"
  case "$v" in '' | *[!0-9]*) ;; *) printf '%s' "$v" ;; esac
}
write_state() { printf '%s\n' "$2" >"$STATE/$1"; }

run_shared_checks

# --- user count: high-water mark, never lowered silently
cur_users=''
if [ "$DOCKER_OK" = 1 ] && body="$(fetch_health)"; then
  cur_users="$(printf '%s' "$body" | jq -r '.users // empty' 2>/dev/null || true)"
fi
[ -n "$cur_users" ] || cur_users="$(user_count "$OPENGYM_ROOT/data")"
case "$cur_users" in '' | *[!0-9]*) cur_users='' ;; esac
if [ -n "$cur_users" ]; then
  mark="$(read_state users)"
  if [ "$ACCEPT" = 1 ] || [ -z "$mark" ] || [ "$cur_users" -ge "$mark" ]; then
    write_state users "$cur_users"
    report OK users "$cur_users users (reference ${mark:-new})"
  else
    report FAIL users "the user count fell from $mark to $cur_users" "Signature of a db.json reset: stop the API and restore db.json (operations.md Troubleshooting). If it is deliberate: opengym monitor --accept-users"
  fi
fi

# --- container restarts since the last run
if [ "$DOCKER_OK" = 1 ]; then
  for svc in api web; do
    svc_running "$svc" || continue
    now_n="$(svc_restart_count "$svc")"
    case "$now_n" in '' | *[!0-9]*) now_n=0 ;; esac
    prev_n="$(read_state "restarts-$svc")"
    write_state "restarts-$svc" "$now_n"
    if [ -n "$prev_n" ] && [ "$now_n" -gt "$prev_n" ]; then
      report WARN "restarts-$svc" "$svc restarted $((now_n - prev_n)) time(s) since the last check" "Look for a crash: opengym logs $svc --errors"
    else
      report OK "restarts-$svc" "no new restarts of $svc"
    fi
  done
fi

# --- push failure spike (last hour)
if [ "$DOCKER_OK" = 1 ] && [ "$API_UP" = 1 ]; then
  fails="$(compose_cmd logs api --since 1h 2>/dev/null | grep -c 'push send failed' || true)"
  case "$fails" in '' | *[!0-9]*) fails=0 ;; esac
  if [ "$fails" -ge "$PUSH_FAIL_WARN" ]; then
    report WARN push "$fails push failures in the last hour" "Stale subscriptions or a bad VAPID subject: opengym logs api --errors; set VAPID_SUBJECT=mailto:you@example.com"
  else
    report OK push "push delivery looks normal ($fails failures in the last hour)"
  fi
fi

# --- output (before alerts, which only go to the log from here on)
if [ "$JSON" = 1 ]; then
  render_json
elif [ "$QUIET" = 0 ]; then
  for ((i = 0; i < RES_N; i++)); do
    if [ "${RES_STATUS[i]}" != OK ] || [ "$VERBOSE" = 1 ]; then
      printf '  [%-4s] %-13s %s\n' "${RES_STATUS[i]}" "${RES_ID[i]}" "${RES_MSG[i]}"
      [ "${RES_STATUS[i]}" != OK ] && [ -n "${RES_HINT[i]}" ] && printf '         fix: %s\n' "${RES_HINT[i]}"
    fi
  done
fi

# --- alerts
export OPENGYM_QUIET=1
for ((i = 0; i < RES_N; i++)); do
  key="mon-${RES_ID[i]}"
  case "${RES_STATUS[i]}" in
    FAIL) alert crit "$key" "openGym: ${RES_ID[i]}" "${RES_MSG[i]}. ${RES_HINT[i]}" ;;
    WARN) alert warn "$key" "openGym: ${RES_ID[i]}" "${RES_MSG[i]}. ${RES_HINT[i]}" ;;
    *) alert_clear "$key" "openGym recovered: ${RES_ID[i]}" ;;
  esac
done

exit "$LEVEL"
