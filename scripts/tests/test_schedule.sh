#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"
export OPENGYM_QUIET=0

setup() {
  new_sandbox
  mkdir -p "$SB/bin"
  export CRON_FILE="$SB/crontab.txt"
  cat >"$SB/bin/crontab" <<'FAKE'
#!/bin/sh
case "$1" in
  -l) if [ -f "$CRON_FILE" ]; then cat "$CRON_FILE"; else echo "no crontab for test" >&2; exit 1; fi ;;
  -) cat >"$CRON_FILE" ;;
esac
FAKE
  chmod +x "$SB/bin/crontab"
  PATH="$SB/bin:$PATH"
}
cron() { cat "$CRON_FILE"; }
count() { grep -c -- "$1" "$CRON_FILE" || true; }

# ---------- install
setup
printf '0 1 * * * echo mine\n' >"$CRON_FILE"
assert_exit 0 "install" -- "$OG" schedule install --yes
assert_contains "# BEGIN opengym $SB" "$(cron)" "block start marker"
assert_contains "# END opengym $SB" "$(cron)" "block end marker"
assert_contains "15 3 * * * cd '$SB' && scripts/opengym backup --quiet >/dev/null" "$(cron)" "daily backup at 03:15"
assert_contains "*/15 * * * * cd '$SB' && scripts/opengym monitor --quiet" "$(cron)" "monitor every 15 minutes"
assert_contains "PATH=" "$(cron)" "PATH set for cron"
assert_contains "0 1 * * * echo mine" "$(cron)" "existing jobs preserved"
assert_not_contains "report" "$(cron)" "no report job without the stats suite"

# idempotent
first="$(cron)"
assert_exit 0 "install again" -- "$OG" schedule install --yes
assert_eq "$first" "$(cron)" "identical crontab after a second install"
assert_eq 1 "$(count "BEGIN opengym")" "a single block"

# options
setup
"$OG" schedule install --yes --backup-time 04:30 --monitor-every 5 >/dev/null 2>&1
assert_contains "30 4 * * * cd" "$(cron)" "custom backup time"
assert_contains "*/5 * * * * cd" "$(cron)" "custom monitor period"
setup; "$OG" schedule install --yes --monitor-every 60 >/dev/null 2>&1
assert_contains "0 * * * * cd" "$(cron)" "60 minutes = hourly"
setup; "$OG" schedule install --yes --backup-time 9:05 >/dev/null 2>&1
assert_contains "5 9 * * * cd" "$(cron)" "H:MM accepted"
setup; "$OG" schedule install --yes --no-monitor >/dev/null 2>&1
assert_not_contains "monitor" "$(cron)" "--no-monitor"
assert_contains "backup" "$(cron)" "backup kept"
setup; "$OG" schedule install --yes --no-backup >/dev/null 2>&1
assert_not_contains "backup" "$(cron)" "--no-backup"
assert_contains "monitor" "$(cron)" "monitor kept"
assert_exit 2 "nothing to schedule" -- "$OG" schedule install --yes --no-backup --no-monitor
for bad in 25:00 3:7 noon 24:00; do assert_exit 2 "bad time $bad" -- "$OG" schedule install --yes --backup-time "$bad"; done
for bad in 0 61 abc ""; do assert_exit 2 "bad period '$bad'" -- "$OG" schedule install --yes --monitor-every "$bad"; done
assert_exit 2 "bad user" -- "$OG" schedule install --yes --system --user 'a b'

# report job only when the stats suite exists under the folder
setup; mkdir -p "$SB/scripts/stats"; : >"$SB/scripts/stats/report.sh"
"$OG" schedule install --yes >/dev/null 2>&1
assert_contains "0 7 1 * * cd '$SB' && scripts/opengym report --quiet" "$(cron)" "monthly report when available"

# ---------- confirmation
setup
assert_exit 1 "no TTY and no --yes aborts" -- "$OG" schedule install
assert_contains "aborted" "$T_OUT" "says aborted"
assert_no_file "$CRON_FILE" "nothing written"
assert_exit 0 "yes on a terminal" -- env OPENGYM_FORCE_TTY=1 "$BASH" -c 'echo y | "$0" schedule install' "$OG"
assert_file "$CRON_FILE" "written after yes"

# ---------- remove
setup
printf '0 1 * * * echo mine\n' >"$CRON_FILE"
"$OG" schedule install --yes >/dev/null 2>&1
assert_exit 0 "remove" -- "$OG" schedule remove
assert_not_contains "opengym" "$(cron)" "block removed"
assert_contains "0 1 * * * echo mine" "$(cron)" "user's own jobs kept"
assert_exit 0 "remove when absent" -- "$OG" schedule remove
assert_contains "no opengym jobs" "$T_OUT" "says nothing to remove"
setup
assert_exit 0 "remove without any crontab" -- "$OG" schedule remove

# ---------- two instances do not clobber each other
setup
mkdir -p "$SB/other"
"$OG" schedule install --yes >/dev/null 2>&1
OPENGYM_ROOT="$SB/other" "$OG" schedule install --yes >/dev/null 2>&1
assert_eq 2 "$(count "BEGIN opengym")" "two blocks for two folders"
OPENGYM_ROOT="$SB/other" "$OG" schedule remove >/dev/null 2>&1
assert_eq 1 "$(count "BEGIN opengym")" "only the other folder's block removed"
assert_contains "# BEGIN opengym $SB" "$(cron)" "first folder's block intact"

# ---------- show
setup
assert_exit 0 "show when nothing is scheduled" -- "$OG" schedule show
assert_contains "No opengym jobs" "$T_OUT" "says none"
"$OG" schedule install --yes >/dev/null 2>&1
assert_exit 0 "show" -- "$OG" schedule show
assert_contains "backup --quiet" "$T_OUT" "shows the jobs"
assert_contains "monitor --quiet" "$T_OUT" "shows the monitor job"
assert_exit 0 "show --systemd" -- "$OG" schedule show --systemd
assert_contains "[Timer]" "$T_OUT" "prints timer units"
assert_contains "ExecStart=$SB/scripts/opengym backup --quiet" "$T_OUT" "units point at this folder"
assert_contains "OnCalendar=*-*-* 03:15:00" "$T_OUT" "daily time in the unit"

# ---------- system mode
setup
mkdir -p "$SB/cron.d"
export OPENGYM_CRON_D="$SB/cron.d"
assert_exit 0 "install --system" -- "$OG" schedule install --yes --system --user alice
f="$(ls "$SB"/cron.d/opengym-* 2>/dev/null | head -1)"
assert_file "$f" "cron.d file created"
assert_contains "15 3 * * * alice cd '$SB'" "$(cat "$f")" "user field present"
assert_no_file "$CRON_FILE" "user crontab untouched in system mode"
assert_exit 0 "show sees system jobs" -- "$OG" schedule show
assert_contains "System jobs" "$T_OUT" "mentions system jobs"
assert_exit 0 "remove --system" -- "$OG" schedule remove --system
assert_no_file "$f" "cron.d file removed"
chmod 500 "$SB/cron.d"
if [ "$(id -u)" != 0 ]; then
  assert_exit 1 "system dir not writable" -- "$OG" schedule install --yes --system
  assert_contains "sudo" "$T_OUT" "suggests sudo"
fi
chmod 700 "$SB/cron.d"
unset OPENGYM_CRON_D

# ---------- environment problems
setup
P="$(limited_path bash sed cut sort wc basename dirname tr head cat date mkdir grep awk cksum id paste)"
assert_exit 1 "no crontab command" -- env PATH="$P" "$BASH" "$OG" schedule install --yes
assert_contains "--system" "$T_OUT" "suggests --system or systemd"
setup
mkdir -p "$SB/we%ird"
assert_exit 1 "path with a % is refused" -- env OPENGYM_ROOT="$SB/we%ird" "$OG" schedule install --yes
mkdir -p "$SB/it's"
assert_exit 1 "path with a quote is refused" -- env OPENGYM_ROOT="$SB/it's" "$OG" schedule install --yes

# ---------- usage
assert_exit 2 "action required" -- "$OG" schedule
assert_exit 2 "unknown action" -- "$OG" schedule frobnicate
assert_exit 2 "unknown option" -- "$OG" schedule install --bogus
assert_exit 0 "--help" -- "$OG" schedule --help

t_summary
