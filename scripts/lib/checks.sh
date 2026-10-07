# shellcheck shell=bash
# Health-check framework shared by `doctor` and `monitor`.
# report <OK|WARN|FAIL> <id> <message> [fix hint]   records one result and raises LEVEL (0 OK, 10 WARN, 20 FAIL).

# shellcheck source=compose.sh
. "${BASH_SOURCE[0]%/*}/compose.sh"
# shellcheck source=data.sh
. "${BASH_SOURCE[0]%/*}/data.sh"

RES_STATUS=() RES_ID=() RES_MSG=() RES_HINT=()
RES_N=0
LEVEL=0

report() { # status id message [hint]
  RES_STATUS[RES_N]="$1"
  RES_ID[RES_N]="$2"
  RES_MSG[RES_N]="$3"
  RES_HINT[RES_N]="${4:-}"
  RES_N=$((RES_N + 1))
  case "$1" in
    WARN) [ "$LEVEL" -ge 10 ] || LEVEL=10 ;;
    FAIL) LEVEL=20 ;;
  esac
  return 0
}

render_text() {
  local i c
  for ((i = 0; i < RES_N; i++)); do
    case "${RES_STATUS[i]}" in
      OK) c="$C_GREEN" ;;
      WARN) c="$C_YELLOW" ;;
      *) c="$C_RED" ;;
    esac
    printf '  [%s%-4s%s] %-13s %s\n' "$c" "${RES_STATUS[i]}" "$C_RESET" "${RES_ID[i]}" "${RES_MSG[i]}"
    if [ "${RES_STATUS[i]}" != OK ] && [ -n "${RES_HINT[i]}" ]; then
      printf '         fix: %s\n' "${RES_HINT[i]}"
    fi
  done
}

verdict_word() {
  case "$LEVEL" in 0) echo ok ;; 10) echo attention ;; *) echo problem ;; esac
}

render_json() {
  local i
  {
    for ((i = 0; i < RES_N; i++)); do
      jq -cn --arg s "${RES_STATUS[i]}" --arg id "${RES_ID[i]}" --arg m "${RES_MSG[i]}" --arg h "${RES_HINT[i]}" \
        '{status:$s, id:$id, message:$m, hint:(if $h == "" then null else $h end)}'
    done
  } | jq -s --arg v "$(verdict_word)" --argjson l "$LEVEL" '{verdict:$v, exit:$l, checks:.}'
}

# ---------------------------------------------------------------- individual checks

_kb_of() { # file -> size in KB (rounded down)
  local b
  b="$(wc -c <"$1" | tr -d ' ')"
  echo $((b / 1024))
}

chk_docker() {
  if daemon_up; then
    report OK docker "Docker daemon is running"
    DOCKER_OK=1
  else
    report FAIL docker "Docker is not running" "Start Docker (Docker Desktop, or: sudo systemctl start docker), then: gymme start"
    DOCKER_OK=0
  fi
}

chk_services() {
  [ "$DOCKER_OK" = 1 ] || return 0
  local svc n
  API_UP=0
  for svc in api web; do
    if svc_running "$svc"; then
      [ "$svc" = api ] && API_UP=1
      n="$(svc_restart_count "$svc")"
      case "$n" in '' | *[!0-9]*) n=0 ;; esac
      if [ "$n" -ge 3 ]; then
        report WARN "svc-$svc" "$svc is running but restarted $n times" "Crash loop? Run: gymme logs $svc --errors"
      else
        report OK "svc-$svc" "$svc is running"
      fi
    else
      report FAIL "svc-$svc" "$svc is not running" "Run: gymme start, then: gymme logs $svc --errors"
    fi
  done
}

chk_http() {
  [ "$DOCKER_OK" = 1 ] || return 0
  local body
  if curl -fsS --max-time 5 -o /dev/null "$BASE_URL/" >/dev/null 2>&1; then
    report OK front-door "$BASE_URL/ answers"
  else
    report FAIL front-door "$BASE_URL/ does not answer" "nginx (web) is down or WEB_PORT differs: gymme logs web; check WEB_PORT in .env"
  fi
  if body="$(fetch_health)" && [ "$(printf '%s' "$body" | jq -r '.ok' 2>/dev/null)" = true ]; then
    report OK api-health "API answers ($(printf '%s' "$body" | jq -r '.users // "?"') users)"
  else
    report FAIL api-health "the API does not answer at $BASE_URL/api/health" "502/504 usually means the api container is down: gymme logs api --errors (see operations.md Troubleshooting)"
  fi
}

chk_data() {
  local dir="$GYMME_ROOT/data" f mode n
  if [ -d "$dir" ] && [ -w "$dir" ]; then
    report OK data-dir "data/ exists and is writable"
  else
    report FAIL data-dir "data/ is missing or not writable" "A read-only or missing volume makes every write fail (500): check the bind mount and permissions of ./data"
    return 0
  fi
  if [ ! -f "$dir/db.json" ]; then
    report FAIL db-json "data/db.json is missing" "Nobody can sign in. Restore a backup: gymme restore <archive>"
  elif ! json_valid "$dir/db.json"; then
    report FAIL db-json "data/db.json is not valid JSON" "Stop the API and restore it: gymme restore <archive> (see data-model.md Integrity)"
  else
    report OK db-json "db.json is valid ($(user_count "$dir") users)"
  fi
  for f in secret vapid.json; do
    local id="secret"
    [ "$f" = vapid.json ] && id="vapid"
    if [ ! -f "$dir/$f" ]; then
      if [ "$f" = secret ]; then
        report WARN "$id" "data/secret is missing" "Created at API start; if it is missing after a restart the volume is not persisted: users are signed out each time"
      else
        report WARN "$id" "data/vapid.json is missing" "Created at first API start; without it push subscriptions cannot be sent"
      fi
      continue
    fi
    mode="$(file_mode "$dir/$f")"
    if [ "$mode" != 600 ]; then
      report WARN "$id" "data/$f has mode $mode (expected 600)" "chmod 600 data/$f"
    else
      report OK "$id" "data/$f present, mode 600"
    fi
  done
  n="$(find "$dir" -maxdepth 1 -name '*.tmp' -mmin +60 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n" -gt 0 ]; then
    report WARN tmp "$n stray *.tmp file(s) older than 1 h in data/" "An interrupted write; harmless but untidy: gymme prune"
  else
    report OK tmp "no stray *.tmp files"
  fi
  local big='' worst=0 kb
  for f in "$dir"/state-*.json; do
    [ -e "$f" ] || continue
    kb="$(_kb_of "$f")"
    [ "$kb" -gt "$worst" ] && worst="$kb"
    [ "$kb" -ge "$STATE_WARN_KB" ] && big="$big $(basename "$f")(${kb}KB)"
  done
  if [ "$worst" -ge 1024 ]; then
    report FAIL state-size "state file(s) over nginx's 1 MB body limit:$big" "That user's sync fails with 413: raise client_max_body_size (deployment.md#request-size)"
  elif [ -n "$big" ]; then
    report WARN state-size "state file(s) approaching 1 MB:$big" "Plan to raise client_max_body_size (deployment.md#request-size)"
  else
    report OK state-size "all state files are below ${STATE_WARN_KB} KB"
  fi
}

chk_env() {
  local env="$GYMME_ROOT/.env" rp origin host
  if [ ! -f "$env" ]; then
    report FAIL env ".env is missing" "Run: gymme install (RP_ID and ORIGIN must be restored exactly or every passkey fails)"
    return 0
  fi
  rp="$(env_value "$env" RP_ID)"
  origin="$(env_value "$env" ORIGIN)"
  host="${origin#*://}"
  host="${host%%[:/]*}"
  if [ -z "$rp" ] || [ -z "$origin" ]; then
    report FAIL env "RP_ID or ORIGIN is not set in .env" "Set both, then: docker compose up -d"
  elif [ "$host" != "$rp" ]; then
    report FAIL env "ORIGIN host ($host) differs from RP_ID ($rp)" "Passkeys will fail: make them match, then: docker compose up -d"
  else
    case "$origin" in
      http://*) [ "$rp" = localhost ] || { report WARN env "ORIGIN is plain http on $rp" "Passkeys need HTTPS (except on localhost): put a TLS reverse proxy in front (deployment.md)"; return 0; } ;;
    esac
    report OK env ".env is consistent (RP_ID=$rp)"
  fi
  if [ "$DOCKER_OK" = 1 ] && [ "${API_UP:-0}" = 1 ] && [ -n "$rp" ] && [ -n "$origin" ]; then
    local line live_rp live_origin
    line="$(compose_cmd logs api --tail 300 2>/dev/null | grep 'gym-api on' | tail -n 1 || true)"
    if [ -n "$line" ]; then
      live_rp="$(printf '%s' "$line" | sed -n 's/.*rpID=\([^,)]*\).*/\1/p')"
      live_origin="$(printf '%s' "$line" | sed -n 's/.*origin=\([^)]*\)).*/\1/p')"
      if [ "$live_rp" != "$rp" ] || [ "$live_origin" != "$origin" ]; then
        report FAIL env-api "the running API uses rpID=$live_rp origin=$live_origin but .env says RP_ID=$rp ORIGIN=$origin" "Reload the config: docker compose up -d"
      else
        report OK env-api "the running API matches .env"
      fi
    fi
  fi
}

chk_media() {
  local f found=0
  for f in "$GYMME_ROOT"/media/img/*; do [ -e "$f" ] && { found=1; break; }; done
  if [ "$found" = 1 ]; then
    report OK media "exercise media present"
  else
    report WARN media "media/img is empty: exercise images will 404" "Run: scripts/fetch-media.sh, or: docker compose up -d (the media service downloads them)"
  fi
}

_disk_report() { # id label path
  local pct
  [ -d "$3" ] || return 0
  pct="$(disk_used_pct "$3")"
  pct="${pct:-0}"
  if [ "$pct" -ge "$DISK_CRIT_PCT" ]; then
    report FAIL "$1" "$2 disk ${pct}% used (critical at ${DISK_CRIT_PCT}%)" "A full disk makes every write fail: free space (gymme prune, docker system prune, move backups off the host)"
  elif [ "$pct" -ge "$DISK_WARN_PCT" ]; then
    report WARN "$1" "$2 disk ${pct}% used (warning at ${DISK_WARN_PCT}%)" "Free space soon: gymme prune, rotate Docker logs, move backups off the host"
  else
    report OK "$1" "$2 disk ${pct}% used"
  fi
}

chk_disk() {
  _disk_report disk-data data "$GYMME_ROOT/data"
  _disk_report disk-backups backups "$BACKUP_DIR"
}

chk_backup() {
  local now last age
  now="${GYMME_NOW:-$(date +%s)}"
  last="$(last_backup_epoch)"
  if [ "$last" -eq 0 ]; then
    report WARN backup "no backup recorded yet" "Run: gymme backup, then schedule it: gymme schedule install"
    return 0
  fi
  age=$((now - last))
  if [ "$age" -gt $((BACKUP_MAX_AGE_HOURS * 3600)) ]; then
    report WARN backup "last backup is $(human_age "$age") (limit ${BACKUP_MAX_AGE_HOURS} h)" "Run: gymme backup; check the cron job: gymme schedule show"
  else
    report OK backup "last backup $(human_age "$age")"
  fi
}

chk_tls() {
  local origin="${1:-}" hostport host port pem
  case "$origin" in https://*) ;; *) return 0 ;; esac
  hostport="${origin#https://}"
  hostport="${hostport%%/*}"
  host="${hostport%%:*}"
  port=443
  [ "$host" != "$hostport" ] && port="${hostport#*:}"
  [ "$host" = localhost ] && return 0
  command -v openssl >/dev/null 2>&1 || return 0
  pem="$(run_with_timeout 10 bash -c "openssl s_client -connect '$host:$port' -servername '$host' </dev/null 2>/dev/null | openssl x509 2>/dev/null" 2>/dev/null || true)"
  if [ -z "$pem" ]; then
    report WARN tls "could not read the TLS certificate of $host:$port" "Is the reverse proxy up and DNS correct? Passkeys stop working without valid HTTPS"
  elif ! printf '%s\n' "$pem" | openssl x509 -noout -checkend $((3 * 86400)) >/dev/null 2>&1; then
    report FAIL tls "the TLS certificate of $host expires in less than 3 days" "Renew it now (Let's Encrypt / your proxy); passkeys stop working when it expires"
  elif ! printf '%s\n' "$pem" | openssl x509 -noout -checkend $((14 * 86400)) >/dev/null 2>&1; then
    report WARN tls "the TLS certificate of $host expires in less than 14 days" "Check automatic renewal on your reverse proxy"
  else
    report OK tls "TLS certificate of $host is valid for more than 14 days"
  fi
}

# The checks both `doctor` and `monitor` run, in a stable order.
run_shared_checks() {
  DOCKER_OK=0 API_UP=0
  chk_docker
  chk_services
  chk_http
  chk_data
  chk_env
  chk_media
  chk_disk
  chk_backup
  chk_tls "${ORIGIN:-}"
}
