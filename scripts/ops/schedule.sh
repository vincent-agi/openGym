#!/usr/bin/env bash
# desc: Install, remove or show the cron jobs (backup, monitor, report)
set -euo pipefail
_here="${BASH_SOURCE[0]%/*}/.."
# shellcheck source=../lib/config.sh
. "$_here/lib/config.sh"

usage() {
  cat <<'USAGE'
Usage: opengym schedule install [options]
       opengym schedule remove [--system]
       opengym schedule show [--systemd]

Installs a marked block in YOUR crontab (nothing else in it is touched) that runs from this folder:
  backup   daily at --backup-time (default 03:15)         opengym backup --quiet
  monitor  every --monitor-every minutes (default 15)     opengym monitor --quiet
  report   monthly, only when the stats suite is present  opengym report --quiet
Running install again replaces the block; remove deletes only that block. Several instances (folders) can coexist.

install options:
  --backup-time HH:MM   time of the daily backup
  --monitor-every N     monitor period in minutes (1-60)
  --no-backup           do not schedule the backup
  --no-monitor          do not schedule the monitor
  --system              write /etc/cron.d/opengym-<id> instead of a user crontab (needs root; Linux)
  --user NAME           account the system jobs run as (default: you)
  --yes, -y             do not ask for confirmation
show options:
  --systemd             print systemd service + timer units as an alternative to cron
USAGE
}

ACTION="${1:-}"
case "$ACTION" in
  install | remove | show) shift ;;
  -h | --help | '') usage; [ -n "$ACTION" ] && exit 0; die_usage "say what to do: install, remove or show" ;;
  *) usage >&2; die_usage "unknown action '$ACTION'" ;;
esac

BACKUP_TIME='03:15' MONITOR_EVERY=15 DO_BACKUP=1 DO_MONITOR=1 SYSTEM=0 RUN_USER="${USER:-$(id -un)}" SYSTEMD=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup-time)
      shift
      BACKUP_TIME="${1:-}"
      ;;
    --monitor-every)
      shift
      MONITOR_EVERY="${1:-}"
      ;;
    --no-backup) DO_BACKUP=0 ;;
    --no-monitor) DO_MONITOR=0 ;;
    --system) SYSTEM=1 ;;
    --user)
      shift
      RUN_USER="${1:-}"
      ;;
    --systemd) SYSTEMD=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die_usage "unknown option '$1'" ;;
  esac
  shift
done
export ASSUME_YES="${ASSUME_YES:-0}"

load_config
ROOT="$OPENGYM_ROOT"
case "$ROOT" in
  *"'"* | *%* | *$'\n'*) die "the folder path contains a quote, a % or a newline, which cron cannot handle safely: $ROOT" ;;
esac
SLUG="$(printf '%s' "$ROOT" | cksum | cut -d' ' -f1)"
BEGIN="# BEGIN opengym $ROOT"
END="# END opengym $ROOT"
CROND="${OPENGYM_CRON_D:-/etc/cron.d}"
SYSFILE="$CROND/opengym-$SLUG"

build_block() { # user-field-or-empty
  local u="$1" h m
  [ -n "$u" ] && u="$u "
  h="${BACKUP_TIME%%:*}"; m="${BACKUP_TIME##*:}"
  h=$((10#$h)); m=$((10#$m))
  echo "$BEGIN"
  echo "PATH=$PATH"
  [ "$DO_BACKUP" = 1 ] && echo "$m $h * * * ${u}cd '$ROOT' && scripts/opengym backup --quiet >/dev/null"
  if [ "$DO_MONITOR" = 1 ]; then
    if [ "$MONITOR_EVERY" -ge 60 ]; then
      echo "0 * * * * ${u}cd '$ROOT' && scripts/opengym monitor --quiet"
    else
      echo "*/$MONITOR_EVERY * * * * ${u}cd '$ROOT' && scripts/opengym monitor --quiet"
    fi
  fi
  [ -f "$ROOT/scripts/stats/report.sh" ] && echo "0 7 1 * * ${u}cd '$ROOT' && scripts/opengym report --quiet"
  echo "$END"
}

current_crontab() { crontab -l 2>/dev/null || true; }
strip_block() { # reads stdin
  awk -v b="$BEGIN" -v e="$END" '$0 == b { skip = 1; next } $0 == e { skip = 0; next } !skip { print }'
}
need_crontab() {
  command -v crontab >/dev/null 2>&1 || die "no crontab command on this machine. Use --system (Linux, /etc/cron.d) or the systemd units from: opengym schedule show --systemd"
}

case "$ACTION" in
  install)
    printf '%s' "$BACKUP_TIME" | grep -Eq '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' || die_usage "--backup-time must be HH:MM (24 h), got '$BACKUP_TIME'"
    case "$MONITOR_EVERY" in '' | *[!0-9]*) die_usage "--monitor-every must be a number of minutes (1-60)" ;; esac
    { [ "$MONITOR_EVERY" -ge 1 ] && [ "$MONITOR_EVERY" -le 60 ]; } || die_usage "--monitor-every must be between 1 and 60"
    [ "$DO_BACKUP" = 1 ] || [ "$DO_MONITOR" = 1 ] || die_usage "nothing to schedule (both --no-backup and --no-monitor given)"
    case "$RUN_USER" in '' | *[!A-Za-z0-9._-]*) die_usage "--user must be a plain account name" ;; esac

    if [ "$SYSTEM" = 1 ]; then
      block="$(build_block "$RUN_USER")"
      info "Will write $SYSFILE:"
      printf '%s\n' "$block" | sed 's/^/  /' >&2
      confirm "Install these system jobs?" || die "aborted. Nothing was changed."
      [ -d "$CROND" ] && [ -w "$CROND" ] || die "cannot write to $CROND (run with sudo?)"
      printf '%s\n' "$block" >"$SYSFILE"
      chmod 644 "$SYSFILE"
      ok "installed $SYSFILE (jobs run as $RUN_USER)"
      exit 0
    fi

    need_crontab
    block="$(build_block "")"
    info "Will add to your crontab:"
    printf '%s\n' "$block" | sed 's/^/  /' >&2
    confirm "Install these jobs?" || die "aborted. Nothing was changed."
    new="$({ current_crontab | strip_block; printf '%s\n' "$block"; })"
    printf '%s\n' "$new" | crontab - || die "crontab refused the new table"
    ok "cron jobs installed. See them with: opengym schedule show"
    ;;
  remove)
    if [ "$SYSTEM" = 1 ]; then
      if [ -f "$SYSFILE" ]; then
        rm -f "$SYSFILE" || die "cannot remove $SYSFILE (run with sudo?)"
        ok "removed $SYSFILE"
      else
        ok "no system jobs to remove"
      fi
      exit 0
    fi
    need_crontab
    if ! current_crontab | grep -qxF "$BEGIN"; then
      ok "no opengym jobs for this folder in your crontab"
      exit 0
    fi
    new="$(current_crontab | strip_block)"
    printf '%s\n' "$new" | crontab - || die "crontab refused the new table"
    ok "opengym cron jobs removed (the rest of your crontab was kept)"
    ;;
  show)
    if [ "$SYSTEMD" = 1 ]; then
      cat <<UNITS
# Alternative to cron on Linux: save as /etc/systemd/system/opengym-backup.service and .timer, then:
#   sudo systemctl daemon-reload && sudo systemctl enable --now opengym-backup.timer
# ---- opengym-backup.service
[Unit]
Description=openGym backup

[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=$ROOT/scripts/opengym backup --quiet

# ---- opengym-backup.timer
[Unit]
Description=Daily openGym backup

[Timer]
OnCalendar=*-*-* $BACKUP_TIME:00
Persistent=true

[Install]
WantedBy=timers.target

# ---- opengym-monitor.service
[Unit]
Description=openGym monitor

[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=$ROOT/scripts/opengym monitor --quiet

# ---- opengym-monitor.timer
[Unit]
Description=openGym monitor every $MONITOR_EVERY minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=${MONITOR_EVERY}min

[Install]
WantedBy=timers.target
UNITS
      exit 0
    fi
    shown=0
    if command -v crontab >/dev/null 2>&1 && current_crontab | grep -qxF "$BEGIN"; then
      echo "User crontab:"
      current_crontab | awk -v b="$BEGIN" -v e="$END" '$0 == b { p = 1 } p { print "  " $0 } $0 == e { p = 0 }'
      shown=1
    fi
    if [ -f "$SYSFILE" ]; then
      echo "System jobs ($SYSFILE):"
      sed 's/^/  /' "$SYSFILE"
      shown=1
    fi
    [ "$shown" = 1 ] || echo "No opengym jobs scheduled for $ROOT. Install them with: opengym schedule install"
    [ "$(os_name)" = linux ] && echo "(On Linux you can use systemd timers instead: opengym schedule show --systemd)"
    exit 0
    ;;
esac
