#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
LIB="$REPO_ROOT/scripts/lib/data.sh"
d() { "$BASH" -c '. "$0"; "$@"' "$LIB" "$@"; }

new_sandbox

# json_valid
echo '{"a":1}' >"$SB/ok.json"; echo '{ nope' >"$SB/bad.json"
assert_exit 0 "json_valid accepts valid" -- d json_valid "$SB/ok.json"
assert_exit 1 "json_valid rejects invalid" -- d json_valid "$SB/bad.json"
assert_exit 1 "json_valid rejects missing file" -- d json_valid "$SB/none.json"

# validate_data_dir
use_fixture data_ok
assert_exit 0 "healthy data dir validates" -- d validate_data_dir "$SB/data"
use_fixture data_corrupt_db
assert_exit 1 "corrupt db.json fails" -- d validate_data_dir "$SB/data"
assert_contains "db.json" "$T_OUT" "names db.json"
use_fixture data_ok
echo '{ x' >"$SB/data/state-uBBBBBBBBBBBBBB2.json"
assert_exit 1 "corrupt state file fails" -- d validate_data_dir "$SB/data"
assert_contains "state-uBBBBBBBBBBBBBB2.json" "$T_OUT" "names the bad state file"
rm -rf "$SB/data"; mkdir "$SB/data"
assert_exit 1 "missing db.json fails" -- d validate_data_dir "$SB/data"
assert_contains "db.json" "$T_OUT" "says db.json is missing"
assert_exit 1 "missing dir fails" -- d validate_data_dir "$SB/nodir"

# user_count
use_fixture data_ok
assert_eq "2" "$(d user_count "$SB/data")" "user_count reads db.json"
assert_eq "" "$(d user_count "$SB/nodir")" "user_count empty when unreadable"

# sha256_of
printf 'hello\n' >"$SB/h.txt"
assert_eq "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03" "$(d sha256_of "$SB/h.txt")" "sha256_of"

# human_size
assert_eq "0 B" "$(d human_size 0)" "0 bytes"
assert_eq "1023 B" "$(d human_size 1023)" "bytes"
assert_eq "2.0 KB" "$(d human_size 2048)" "KB"
assert_eq "5.0 MB" "$(d human_size 5242880)" "MB"
assert_eq "3.0 GB" "$(d human_size 3221225472)" "GB"

# human_age
assert_eq "just now" "$(d human_age 30)" "age < 1 min"
assert_eq "5 min ago" "$(d human_age 300)" "age in minutes"
assert_eq "5 h ago" "$(d human_age 18000)" "age in hours"
assert_eq "3 d ago" "$(d human_age 259200)" "age in days"

# disk_used_pct
pct="$(d disk_used_pct "$SB")"
case "$pct" in '' | *[!0-9]*) _t_fail "disk_used_pct numeric (got '$pct')" ;; *) _t_ok ;; esac

# env_value
printf 'RP_ID=gym.example.com\nORIGIN="https://gym.example.com"\n# C=1\nEMPTY=\n' >"$SB/.env"
assert_eq "gym.example.com" "$(d env_value "$SB/.env" RP_ID)" "env_value plain"
assert_eq "https://gym.example.com" "$(d env_value "$SB/.env" ORIGIN)" "env_value strips quotes"
assert_eq "" "$(d env_value "$SB/.env" MISSING)" "env_value missing key"
assert_eq "" "$(d env_value "$SB/nofile" RP_ID)" "env_value missing file"
assert_eq "" "$(d env_value "$SB/.env" C)" "env_value ignores comments"

# last backup bookkeeping
assert_eq "0" "$(d last_backup_epoch)" "no backup recorded = 0"
GYMME_NOW=1234567 d record_backup
assert_eq "1234567" "$(d last_backup_epoch)" "record_backup stores epoch"
assert_eq "600" "$(d file_mode "$SB/.gymme-state/last-backup")" "state file mode 0600"

t_summary
