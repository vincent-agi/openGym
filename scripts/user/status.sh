#!/usr/bin/env bash
# desc: One-glance health: services, API, users, last backup, disk
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"
# shellcheck source=../lib/data.sh
. "$_here/lib/data.sh"

usage() {
  cat <<'USAGE'
Usage: gymme status [--json]

Prints services, API health, user count, last backup age and disk use, then a verdict.
Exit code: 0 OK · 10 attention (e.g. no recent backup, disk filling) · 20 problem (stack down, API not answering).

  --json      machine-readable output
  -h, --help  this help
USAGE
}

JSON=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --json) JSON=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done

load_config
require_cmd jq

ISSUES=()
LEVEL=0
add_issue() { # level message
  ISSUES+=("$2")
  [ "$1" -gt "$LEVEL" ] && LEVEL="$1"
  return 0
}

api_up=false web_up=false health_ok=false users=null
if daemon_up; then
  svc_running api && api_up=true || add_issue 20 "api is not running (try: gymme start)"
  svc_running web && web_up=true || add_issue 20 "web is not running (try: gymme start)"
  if body="$(fetch_health)" && [ -n "$body" ]; then
    health_ok=true
    users="$(printf '%s' "$body" | jq -r '.users // "null"' 2>/dev/null || echo null)"
  else
    add_issue 20 "health check failed at $BASE_URL/api/health"
  fi
else
  add_issue 20 "Docker is not running"
fi

now="${GYMME_NOW:-$(date +%s)}"
last="$(last_backup_epoch)"
age=null
if [ "$last" -eq 0 ]; then
  add_issue 10 "no backup recorded yet (run: gymme backup)"
else
  age=$((now - last))
  if [ "$age" -gt $((BACKUP_MAX_AGE_HOURS * 3600)) ]; then
    add_issue 10 "last backup is older than ${BACKUP_MAX_AGE_HOURS} h ($(human_age "$age"))"
  fi
fi

data="$GYMME_ROOT/data"
[ -d "$data" ] || data="$GYMME_ROOT"
pct="$(disk_used_pct "$data")"
pct="${pct:-0}"
data_kb="$(du -sk "$GYMME_ROOT/data" 2>/dev/null | cut -f1 || true)"
data_bytes=$(( ${data_kb:-0} * 1024 ))
if [ "$pct" -ge "$DISK_CRIT_PCT" ]; then
  add_issue 20 "disk ${pct}% used (critical threshold ${DISK_CRIT_PCT}%)"
elif [ "$pct" -ge "$DISK_WARN_PCT" ]; then
  add_issue 10 "disk ${pct}% used (warning threshold ${DISK_WARN_PCT}%)"
fi

case "$LEVEL" in
  0) verdict=ok ;;
  10) verdict=attention ;;
  *) verdict=problem ;;
esac

if [ "$JSON" = 1 ]; then
  issues_json='[]'
  if [ "${#ISSUES[@]}" -gt 0 ]; then
    issues_json="$(printf '%s\n' "${ISSUES[@]}" | jq -R . | jq -s .)"
  fi
  jq -n \
    --arg verdict "$verdict" --argjson exit "$LEVEL" \
    --argjson api "$api_up" --argjson web "$web_up" \
    --argjson health_ok "$health_ok" --argjson users "$users" \
    --argjson last "$last" --argjson age "$age" --argjson maxh "$BACKUP_MAX_AGE_HOURS" \
    --argjson pct "$pct" --argjson bytes "$data_bytes" --argjson issues "$issues_json" \
    '{verdict:$verdict, exit:$exit, services:{api:$api, web:$web},
      health:{ok:$health_ok, users:$users},
      backup:{last:(if $last == 0 then null else $last end), age_seconds:$age, max_age_hours:$maxh},
      disk:{used_pct:$pct, data_bytes:$bytes}, issues:$issues}'
  exit "$LEVEL"
fi

row() { printf '  %-13s %s\n' "$1" "$2"; }
echo "Gymme status"
row services "api $($api_up && echo running || echo DOWN) · web $($web_up && echo running || echo DOWN)"
if [ "$health_ok" = true ]; then
  row health "ok ($users users)"
else
  row health "not answering"
fi
if [ "$last" -eq 0 ]; then row "last backup" "never"; else row "last backup" "$(human_age "$age")"; fi
row data "$(human_size "$data_bytes"), disk ${pct}% used"
echo
case "$verdict" in
  ok) printf '%sverdict: OK%s\n' "$C_GREEN" "$C_RESET" ;;
  attention) printf '%sverdict: attention%s\n' "$C_YELLOW" "$C_RESET" ;;
  *) printf '%sverdict: problem%s\n' "$C_RED" "$C_RESET" ;;
esac
if [ "${#ISSUES[@]}" -gt 0 ]; then
  for i in "${ISSUES[@]}"; do echo "  - $i"; done
fi
exit "$LEVEL"
