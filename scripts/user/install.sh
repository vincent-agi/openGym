#!/usr/bin/env bash
# desc: First-time setup: check tools, create .env, data/ and backups/
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"
# shellcheck source=../lib/compose.sh
. "$_here/lib/compose.sh"

usage() {
  cat <<'USAGE'
Usage: opengym install [--rp-id HOST] [--origin URL] [--yes]

Checks Docker, Compose, jq, curl and tar, creates .env from .env.example, then data/ and backups/.
It never starts the stack (run `opengym start`) and never overwrites an existing .env.

  --rp-id HOST   passkey relying-party id: the domain users type, no scheme or port (default: localhost)
  --origin URL   full public address, e.g. https://gym.example.com (default: http://localhost:8080)
  --yes, -y      take the defaults without asking
  -h, --help     this help

RP_ID and ORIGIN are bound to every passkey: changing them later makes all existing passkeys fail.
USAGE
}

RP_ID_ARG='' ORIGIN_ARG=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --rp-id)
      shift
      RP_ID_ARG="${1:-}"
      ;;
    --origin)
      shift
      ORIGIN_ARG="${1:-}"
      ;;
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done
export ASSUME_YES="${ASSUME_YES:-0}"

# 1. tools (before creating anything)
require_cmd docker
compose_detect
require_cmd jq
require_cmd curl
require_cmd tar

ENV_FILE="$OPENGYM_ROOT/.env"
EXAMPLE="$OPENGYM_ROOT/.env.example"

valid_rp_id() { case "$1" in '' | *[!A-Za-z0-9.-]* | .* | -* | *. | *-) return 1 ;; *) return 0 ;; esac; }
valid_origin() {
  case "$1" in
    http://* | https://*) ;;
    *) return 1 ;;
  esac
  local rest="${1#*://}"
  case "$rest" in '' | */* | *[!A-Za-z0-9.:-]*) return 1 ;; esac
  local host="${rest%%:*}" port=""
  [ "$host" != "$rest" ] && port="${rest#*:}"
  valid_rp_id "$host" || return 1
  case "$port" in *[!0-9]*) return 1 ;; esac
  return 0
}
origin_host() { local r="${1#*://}"; printf '%s' "${r%%:*}"; }

ask() { # prompt default -> stdout
  local reply=''
  printf '%s [%s]: ' "$1" "$2" >&2
  read -r reply || true
  printf '%s' "${reply:-$2}"
}
interactive() { [ "$ASSUME_YES" != 1 ] && { [ -t 0 ] || [ "${OPENGYM_FORCE_TTY:-}" = 1 ]; }; }

if [ -f "$ENV_FILE" ]; then
  cur_rp="$(sed -n 's/^RP_ID=//p' "$ENV_FILE" | tail -n 1)"
  cur_origin="$(sed -n 's/^ORIGIN=//p' "$ENV_FILE" | tail -n 1)"
  if { [ -n "$RP_ID_ARG" ] && [ "$RP_ID_ARG" != "$cur_rp" ]; } || { [ -n "$ORIGIN_ARG" ] && [ "$ORIGIN_ARG" != "$cur_origin" ]; }; then
    die_usage "a .env already exists (RP_ID=$cur_rp, ORIGIN=$cur_origin) and changing them breaks all existing passkeys. Edit .env by hand if you really mean it."
  fi
  info "Existing .env kept (RP_ID=$cur_rp, ORIGIN=$cur_origin)."
else
  RP_ID_VAL="${RP_ID_ARG:-}" ORIGIN_VAL="${ORIGIN_ARG:-}"
  if interactive; then
    info "RP_ID and ORIGIN are bound to every passkey: choose the final address now."
    [ -n "$RP_ID_VAL" ] || RP_ID_VAL="$(ask "Domain users will type (RP_ID)" localhost)"
    if [ -z "$ORIGIN_VAL" ]; then
      def="http://localhost:8080"
      [ "$RP_ID_VAL" != localhost ] && def="https://$RP_ID_VAL"
      ORIGIN_VAL="$(ask "Full public address (ORIGIN)" "$def")"
    fi
  fi
  : "${RP_ID_VAL:=localhost}"
  : "${ORIGIN_VAL:=http://localhost:8080}"

  valid_rp_id "$RP_ID_VAL" || die_usage "RP_ID must be a bare domain such as gym.example.com (no scheme, port or path), got '$RP_ID_VAL'"
  valid_origin "$ORIGIN_VAL" || die_usage "ORIGIN must look like https://gym.example.com or http://localhost:8080 (no path), got '$ORIGIN_VAL'"
  [ "$(origin_host "$ORIGIN_VAL")" = "$RP_ID_VAL" ] || die_usage "the host of ORIGIN ($(origin_host "$ORIGIN_VAL")) must equal RP_ID ($RP_ID_VAL)"
  case "$ORIGIN_VAL" in
    http://*) [ "$RP_ID_VAL" = localhost ] || warn "ORIGIN uses plain http on a real domain: passkeys need HTTPS (put a TLS reverse proxy in front, see docs/technical/deployment.md)." ;;
  esac

  secure_umask
  if [ -f "$EXAMPLE" ]; then cp "$EXAMPLE" "$ENV_FILE"; else : >"$ENV_FILE"; fi
  for kv in "RP_ID=$RP_ID_VAL" "ORIGIN=$ORIGIN_VAL"; do
    key="${kv%%=*}"
    if grep -q "^$key=" "$ENV_FILE"; then
      sed "s|^$key=.*|$kv|" "$ENV_FILE" >"$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
    else
      printf '%s\n' "$kv" >>"$ENV_FILE"
    fi
  done
  chmod 600 "$ENV_FILE"
  ok "Created .env (RP_ID=$RP_ID_VAL, ORIGIN=$ORIGIN_VAL)"
fi

# 2. directories
mkdir -p "$OPENGYM_ROOT/data"
(umask 077 && mkdir -p "$OPENGYM_ROOT/backups")
chmod 700 "$OPENGYM_ROOT/backups" 2>/dev/null || true
ok "data/ and backups/ are ready"

cat >&2 <<NEXT

Next:
  1. opengym start                 first start downloads ~140 MB of exercise media
  2. Daily backup at 03:15, add this line with: crontab -e
       15 3 * * * cd "$OPENGYM_ROOT" && scripts/opengym backup --quiet
  3. Optional settings (alerts, retention, encryption): cp opengym.conf.example opengym.conf
Remember: RP_ID and ORIGIN are bound to your users' passkeys; do not change them later.
NEXT
