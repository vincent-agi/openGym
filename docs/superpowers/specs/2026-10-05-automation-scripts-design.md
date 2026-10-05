# Automation scripts — design

Date: 2026-10-05 · Status: draft for review · Scope: bash tooling for openGym self-hosters

## 1. Goal

Make an openGym instance comfortable to run, faster to operate and less likely to break, through one CLI,
`scripts/opengym`, that covers three audiences:

| Audience | Needs | Suite |
|---|---|---|
| End user (self-hoster, not technical) | start, stop, update, back up, restore, install | `scripts/user/` |
| Technical admin / dev | diagnostics, monitoring, maintenance, integrity checks, rotation | `scripts/ops/` |
| Technical end user (advanced self-hoster) | cron/systemd, alerts, scheduled reports | `scripts/ops/` + `scripts/stats/` |

Plus a statistics suite (`scripts/stats/`): adoption and growth ("commercial"), product engagement, technical usage,
and a periodic shareable report.

### Confirmed decisions

- Platform: **bash on macOS and Linux**. Windows is out of scope.
- One entry point, `opengym <command>`, dispatching to scripts; each script also runs standalone.
- Alert channels: console + log + exit code (always), generic webhook, local desktop notification, email.
- Stats cover adoption/growth, product engagement, technical usage and a shareable periodic report.
- Delivery is split into four sub-projects, each with its own plan: (1) foundation, (2) user suite, (3) ops suite,
  (4) stats suite. Sub-project 1 comes first; the others depend on it.

### Assumptions (not confirmed, easy to change)

- Runtime dependencies: `bash` ≥ 3.2 (macOS default), `docker` with Compose plugin, `curl`, `jq`, `tar`.
  `age` and `shellcheck` are optional (encryption, CI lint). No `bats`: tests use a small pure-bash runner.
- Stats are read-only on `data/*.json` and aggregated/anonymised by default.
- Existing behaviour documented in `docs/technical/operations.md` is the source of truth; scripts automate it and
  never contradict it.

### Non-goals

- No change to `api/`, `frontend/` or Docker images. No new API endpoints (stats read files on disk).
- No daemon, no web UI, no database. No Windows/PowerShell. No cloud backup uploaders (an `off-host` hook only).
- No modification of `db.json` while the API runs (see data-model.md write semantics).

## 2. Layout

```
scripts/
├── opengym                  dispatcher
├── fetch-media.sh           existing, unchanged
├── lib/
│   ├── common.sh            strict mode, paths, colours, die/warn/info, confirm, require_cmd
│   ├── log.sh               levelled logging to console and file
│   ├── alert.sh             alert <level> <title> <message> → channels
│   ├── compose.sh           docker compose detection, service state helpers
│   └── config.sh            .env + opengym.conf loading, defaults
├── user/    install start stop restart status update backup restore logs
├── ops/     doctor monitor verify prune rotate-keys rollback schedule
├── stats/   adoption engagement tech report
└── tests/   run.sh, helpers, fixtures/, mocks/ (docker, curl, osascript)
```

`# desc: <one line>` in the header of each command script feeds `opengym help`.

## 3. Foundation (sub-project 1)

### Dispatcher

`opengym <cmd> [args]` resolves `scripts/*/<cmd>.sh`, runs it in a subshell and propagates the exit code.
`opengym help` lists commands grouped by suite; `opengym <cmd> --help` prints the script's usage; `opengym --version`
reads `.release-please-manifest.json`. Unknown command exits 2 with a suggestion list.

### Conventions

- Strict mode (`set -euo pipefail`), `shellcheck` clean, bash 3.2 compatible (no associative arrays, no `mapfile`).
- Exit codes: `0` OK · `1` error · `2` usage · `10` degraded/warning · `20` critical. Cron and supervisors can act on them.
- Idempotent. Every destructive action supports `--dry-run`; confirmation prompt unless `--yes`.
- `umask 077` for any file that may contain user data. Backups are `chmod 600`.
- Secrets (`data/secret`, `data/vapid.json`, cookies, push keys, invite codes) are never logged, alerted or read by stats.
- Output is human-readable by default; `--json` on `status`, `doctor`, `monitor`, `stats *` for machines.

### Configuration

Order of precedence: environment → `opengym.conf` (optional, repo root, git-ignored) → `.env` → defaults.
`.env` is only read for keys the API already uses (`RP_ID`, `ORIGIN`, `WEB_PORT`, `ADMIN_UIDS`…); script settings
live in `opengym.conf` so the API never sees them. A documented `opengym.conf.example` is shipped.

| Key | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Where archives go (git-ignored). |
| `BACKUP_KEEP_DAYS` | `30` | Retention; `0` disables pruning. |
| `BACKUP_MAX_AGE_HOURS` | `48` | `status`/`monitor` warn when the last backup is older. |
| `BACKUP_ENCRYPT_TO` | empty | `age` recipient; when set, archives are `.tgz.age`. |
| `BACKUP_OFFHOST_CMD` | empty | Command run with the archive path as `$1` after each backup (rsync, rclone…). |
| `BASE_URL` | `http://127.0.0.1:${WEB_PORT:-8080}` | Used by health checks. |
| `ALERT_WEBHOOK_URL` | empty | Enables the webhook channel. |
| `ALERT_EMAIL_TO` | empty | Enables the email channel. |
| `ALERT_DESKTOP` | `auto` | `auto`, `on`, `off`. |
| `ALERT_COOLDOWN` | `3600` | Seconds a given alert key stays muted. |
| `DISK_WARN_PCT` / `DISK_CRIT_PCT` | `80` / `92` | Disk thresholds for `data/` and `BACKUP_DIR`. |
| `STATE_WARN_KB` | `900` | `state-*.json` size warning (nginx 1 MB limit). |
| `LOG_FILE` | `./logs/opengym.log` | Log destination; rotated by `prune`. |

### Libraries

- `log.sh`: `log_debug|info|warn|error`; timestamped line to the file, coloured line to stderr when a TTY.
- `compose.sh`: finds `docker compose` or `docker-compose`; `compose_up`, `svc_running <name>`, `svc_restart_count <name>`;
  fails with a clear message when Docker is missing or the daemon is down.
- `alert.sh`: `alert <info|warn|crit> <key> <title> <message>`. Always logs. Then, if configured:
  - webhook: `curl` POST `{"level","title","message","host","time"}` JSON, 5 s timeout, failure only warns;
  - desktop: `osascript` on macOS, `notify-send` on Linux, skipped when headless;
  - email: `sendmail` or `mail` if present, otherwise a warning once.
  A channel failure never changes the exit code of the caller. Cooldown state lives in `.opengym-state/` keyed by `<key>`;
  a recovery sends one `info` alert when a muted key clears.

### Tests

`scripts/tests/run.sh` is a pure-bash runner (`assert_eq`, `assert_exit`, `assert_contains`) that prepends `mocks/` to
`PATH` so `docker`, `curl`, `osascript`, `notify-send`, `sendmail` are fakes recording their calls. Fixtures hold sample
`data/` trees (healthy, corrupt `db.json`, oversized state, orphan `*.tmp`). CI gains a `scripts` job: `shellcheck`
on `scripts/**` and `scripts/tests/run.sh`.

## 4. User suite (sub-project 2)

Everything works from a fresh clone with Docker installed. No flags needed for the common path.

| Command | Behaviour |
|---|---|
| `install` | Checks Docker/Compose/jq/curl, creates `.env` from `.env.example` (asks `RP_ID`/`ORIGIN`, warns that changing them later breaks passkeys), creates `data/` and `backups/`, offers to schedule daily backup. |
| `start` | `compose up -d`, waits for `/api/health` (timeout 60 s), prints the URL. Handles first-run media download progress. |
| `stop` / `restart` | Graceful, per service optional (`opengym restart api`). |
| `status` | Services, health, user count, last backup age, disk use, one-line verdict (OK / attention / problem). |
| `update` | Auto-backup → show target `CHANGELOG.md` entry → `git pull --ff-only` → `compose pull` → `up -d` → health wait → verify. On failure prints the exact rollback command and offers `opengym rollback`. |
| `backup` | Archive `opengym-YYYY-MM-DD-HHMMSS.tgz` of `data/` + `.env` (never `media/` or `*.tmp`), `umask 077`, optional brief `stop api` for a consistent snapshot (`--consistent`, default for manual runs, off for `--quiet` cron runs), optional `age` encryption, retention prune, optional off-host hook, writes a `.sha256`. Records last-success timestamp. |
| `restore <archive>` | Decrypts if needed, verifies checksum, validates JSON of the archive **before** touching anything, stops stack, moves current `data/` to `data.broken.<date>` (never deletes), extracts, validates `db.json`/`state-*.json` with `jq empty`, starts, health-checks, prints user-count sanity line. `--dry-run` lists what would change. Warns when the archive's `RP_ID`/`ORIGIN` differ from the current `.env`. |
| `logs [svc]` | `compose logs -f --tail=100`, with `--errors` to filter `push send failed` and stack traces. |

## 5. Ops suite (sub-project 3)

| Command | Behaviour |
|---|---|
| `doctor` | One-shot diagnosis mapped to the troubleshooting table of operations.md: Docker/daemon, containers up and restart count, `/` and `/api/health`, `data/` writable, `db.json` valid JSON and user count, `secret` present and mode 0600, `vapid.json` present, `ORIGIN`/`RP_ID` consistent with `.env` and the API startup log line, media present, orphan `*.tmp`, oversized states, disk, last backup age, HTTPS vs `Secure` cookie mismatch. Each check yields OK/WARN/FAIL with the fix hint. Exit 0/10/20. |
| `monitor` | Cron-friendly subset of `doctor` plus **user-count drop** detection (state in `.opengym-state/users`), backup older than 2× expected interval, container restart-count increase, disk thresholds, `push send failed` spike in the last interval, TLS certificate expiry (≤ 14 d warn, ≤ 3 d crit) when `BASE_URL` is https. Silent when healthy, alerts through `alert.sh`, exit code 0/10/20. |
| `verify` | Integrity: every `state-*.json` and `db.json` parse, every `creds.userId` has a user, orphan state files and orphan subs reported (never auto-deleted), duplicate ids. Read-only. Optional `--backup <archive>` to verify an archive without extracting into `data/`. |
| `prune` | Removes stale `*.tmp` older than 1 h (only when API idle check passes), rotates `LOG_FILE`, expires old backups beyond retention, lists `data.broken.*`/`data.bak.*` older than 30 d and asks before removal, can run `docker image prune` for dangling openGym images only. Without a TTY it only reports (implicit `--dry-run`); deleting requires an explicit `--yes`. |
| `rotate-keys session|vapid` | Automates the documented procedures (instance-wide logout, VAPID rotation) with a mandatory backup, a warning about the user impact, then restart and health check. |
| `rollback [tag]` | Pins previous image tag (`:sha-<short>` or `:X.Y.Z`) in a generated `docker-compose.override.yml`, `up -d`, health check; `rollback --clear` removes the override. Restores data only with `--with-data <archive>`. |
| `schedule install|remove|show` | Installs backup/monitor/stats-report jobs as user cron entries (macOS/Linux) with marker comments so removal is clean; prints a systemd timer alternative on Linux. Never edits system files without `--system`. |

## 6. Stats suite (sub-project 4)

Read-only, no API change: parse `data/db.json` and `data/state-*.json` with `jq`. Default output is **aggregated and
anonymised**: no names, no ids, no individual body-weight, nutrition or measurement values, no push endpoints.
`--detail` (admin only, stderr warning) adds user ids and names for operational use. Time window via
`--from/--to/--since 30d`; formats `table` (default), `--json`, `--csv`, `--md`.

| Command | Metrics |
|---|---|
| `adoption` ("commercial") | Total/active/disabled accounts; signups per week and month; invite funnel (created, used, revoked, conversion, oldest unused); DAU/WAU/MAU from workout dates and `_ts`; retention D7/D30 (user active ≥ N days after `created`); growth rate; churn proxy (no activity in 30/60/90 d). |
| `engagement` | Workouts per active user per week; median session duration and volume; share of users using nutrition, measurements, goals, reminders, custom exercises, push; most-used exercises and routines; PR frequency; effort tracking mode split (none/RIR/RPE); unit split kg/lb; language and theme split. |
| `tech` | Instance size: users, `data/` size, state-file size distribution (p50/p95/max) and those near the 1 MB nginx limit; growth of `data/` over time (from stored snapshots); backup freshness and size trend; push subscription health. Appends a sample to `.opengym-state/stats.csv` so trends need no extra service. |
| `report` | Monthly (or `--since`) shareable report combining the three above as Markdown and optionally self-contained HTML, anonymised, written to `reports/` and optionally sent through the alert channels (`info`). Deterministic: same data and window give identical output (testable with fixtures). |

Privacy rules, enforced by tests: reports contain no string from `name`, `id`, `endpoint`, `keys`, `code` fields; small
cohorts (< 5 users) are shown as `<5` to avoid re-identification.

Known limits, stated in the output footer: no access logs exist, so "active" means *logged a workout or synced state*;
sign-in events are not recorded by the app (operations.md "Logs"). Schema is not versioned, so every `jq` filter
tolerates missing keys.

## 7. Error handling

- Missing dependency → exit 1, one-line install hint per OS.
- Docker daemon down → exit 20 from `monitor`/`doctor`, friendly message from user commands.
- Any command that mutates data takes a backup first (`update`, `restore`, `rotate-keys`, `prune --yes`) unless `--no-backup`.
- Failure after a partial step prints exactly what state the system is in and the one command to recover.
- `restore` and `rollback` never delete: previous state is renamed with a dated suffix.

## 8. Testing and CI

- Unit/integration tests with mocks and fixtures for every command; stats snapshot tests on a fixed fixture.
- Real smoke test in CI (optional job): `docker compose up -d` on a runner, `opengym status`, `backup`, `restore`, `doctor`.
- `shellcheck` on all scripts, and a check that `opengym help` lists every script (no orphan).
- Docs: new `docs/technical/automation.md` (command reference, exit codes, cron examples, alert setup) and a short
  `docs/user/` page "Keeping your instance healthy"; `operations.md` "At a glance" gains `opengym` equivalents.

## 9. Delivery order

1. Foundation: dispatcher, libs, config, tests runner, CI job, docs skeleton.
2. User suite: `install start stop restart status update backup restore logs`.
3. Ops suite: `doctor monitor verify prune rotate-keys rollback schedule`.
4. Stats suite: `adoption engagement tech report`.

Each sub-project ends with working, tested, documented commands and can ship on its own.

## 10. Open questions

None blocking. Defaults above (retention 30 d, thresholds, cohort floor 5, cooldown 1 h) are proposals; adjust at review.
