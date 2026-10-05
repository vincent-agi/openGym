# Automation scripts (`opengym` CLI)

One entry point, `scripts/opengym`, runs the maintenance, monitoring and reporting scripts for an openGym instance managed
with Docker Compose. Platform: **bash on macOS and Linux** (bash 3.2 compatible). Design:
[`docs/superpowers/specs/2026-10-05-automation-scripts-design.md`](../superpowers/specs/2026-10-05-automation-scripts-design.md).

> Status: the **foundation**, the **user suite** and the **ops suite** are in place. The `stats` suite is delivered by a
> later sub-project.

## Install

Nothing to install: run it from the repository root.

```bash
scripts/opengym help
scripts/opengym version
```

To call it from anywhere, symlink it onto your `PATH` (the dispatcher resolves symlinks):

```bash
ln -s "$PWD/scripts/opengym" /usr/local/bin/opengym      # or ~/.local/bin on Linux
opengym --version
```

Requirements: `bash`, `curl`, `jq`, and Docker with the Compose plugin for the commands that manage containers. `age` is
optional (backup encryption).

## Commands

`opengym <command> [args]` runs `scripts/{user,ops,stats}/<command>.sh`. `opengym <command> --help` prints that command's usage.
`opengym help --check` fails if a script has no `# desc:` header or a name exists in two suites (used by CI).

| Suite | Audience | Commands |
|---|---|---|
| `user` | Anyone self-hosting | `install start stop restart status update backup restore logs version` (available) |
| `ops` | Admins, technical self-hosters | `doctor monitor verify prune rotate-keys rollback schedule` (available) |
| `stats` | Admins, project owners | `adoption engagement tech report` (planned) |

New commands start from [`scripts/TEMPLATE.sh`](../../scripts/TEMPLATE.sh).

### User suite reference

| Command | What it does | Useful options |
|---|---|---|
| `install` | Checks Docker/Compose/jq/curl/tar, creates `.env` from `.env.example` (asks for `RP_ID` and `ORIGIN`, validates them, never overwrites an existing `.env`), creates `data/` and `backups/`, prints the cron line for a daily backup. Never starts the stack. | `--rp-id HOST`, `--origin URL`, `--yes` |
| `start` | `docker compose up -d`, waits for `/api/health`, prints the URL. | `--no-wait`, `--timeout N` |
| `stop` | Stops the stack. Data is never touched. | `--down`, service names |
| `restart` | Restarts the stack or given services and waits for health. | `--no-wait`, `--timeout N`, service names |
| `status` | Services, API health, user count, last backup age, disk use, verdict. Exit `0` OK · `10` attention · `20` problem. | `--json` |
| `backup` | `data/` + `.env` (never `media/`, never `*.tmp`) into `BACKUP_DIR` as `opengym-YYYY-MM-DD-HHMMSS.tgz`, mode `0600`, with `.sha256`. Optional `age` encryption, retention, off-host hook. Prints the archive path on stdout. Exit `10` when only the off-host hook failed. | `--consistent`, `--no-consistent`, `--quiet`, `--dry-run`, `--out DIR` |
| `restore ARCHIVE` | Verifies checksum, rejects unsafe paths, links and unexpected entries, validates all JSON **before** touching anything, asks for confirmation, stops the stack, moves the current `data/` to `data.broken.<timestamp>` (never deleted), restores `data/` and `.env`, starts, checks health and user count. | `--dry-run`, `--yes`, `--no-start`, `--identity FILE` |
| `update` | Backup, shows the upstream CHANGELOG entry, `git pull --ff-only` (when this is a clone), `compose pull` (builds from source if the pull fails), `up -d`, waits for health, fails if the user count dropped. On failure prints how to go back. | `--yes`, `--dry-run`, `--no-backup`, `--no-git` |
| `logs` | Container logs, following by default. | `--tail N`, `--no-follow`, `--errors`, service names |
| `version` | Versions of opengym, Docker Compose, jq, curl. | |

Notes:

- **Consistent vs live backup.** By hand, `backup` stops the API for a few seconds so `db.json` and the state files are one
  snapshot (the API is always restarted, even if the backup fails). With `--quiet` (cron) it is a live copy unless
  `--consistent` is added. If Docker is down or the API is not running it falls back to a live copy and says so.
- **Retention.** Archives named `opengym-*` older than `BACKUP_KEEP_DAYS` are pruned from `BACKUP_DIR` after a successful
  backup. `BACKUP_KEEP_DAYS=0` disables pruning. Archives written with `--out` are never pruned.
- **Encryption.** Set `BACKUP_ENCRYPT_TO` to an [age](https://github.com/FiloSottile/age) recipient; archives become
  `.tgz.age`. Restore with `--identity key.txt` or `BACKUP_AGE_IDENTITY=key.txt`.
- **Cron.** `15 3 * * * cd /srv/openGym && scripts/opengym backup --quiet` (printed by `install`). A failing backup raises
  a `crit` alert (`backup-failed`), and the next success sends a "recovered" notice.
- **Restore safety.** The archive is only trusted after it passed every check; if the API does not come back, the command
  prints the exact commands to put the previous data back.
- **Update safety.** The previous git commit, user count and backup path are saved in `.opengym-state/pre-update`.

### Ops suite reference

| Command | What it does | Useful options |
|---|---|---|
| `doctor` | One-shot diagnosis: Docker, containers (and restart loops), front door, API, `data/` writable, `db.json`, `secret`/`vapid.json` presence and mode, `.env` consistency (`ORIGIN` host = `RP_ID`) and whether the **running** API uses the same values, media, stray `*.tmp`, state file sizes vs nginx's 1 MB limit, disk, backup age, TLS expiry. Every problem comes with the fix. Exit `0` / `10` / `20`. | `--json` |
| `monitor` | The same checks plus a **fall in the user count** (high-water mark: the signature of a `db.json` reset), **container restarts** since the last run and a **push-failure spike**. Prints only what is wrong. Each problem raises an alert (key `mon-<check>`, muted for `ALERT_COOLDOWN`); a recovery notice follows when it clears. Exit `0` / `10` / `20`. | `--quiet`, `--verbose`, `--json`, `--accept-users` |
| `verify` | Read-only integrity: JSON validity, credentials / push subscriptions / invites pointing at existing users, unique ids, state files without a user. Never repairs or deletes. `--backup` opens an archive in a temporary folder with the same safety checks as `restore`. | `--backup ARCHIVE`, `--identity FILE`, `--json` |
| `prune` | Lists then removes: `data/*.tmp` older than 1 h, backups past `BACKUP_KEEP_DAYS`, `data.broken.*` / `data.bak.*` older than 30 days (they hold user data), and rotates the log past `LOG_MAX_KB` (default 1024). Without a terminal it only reports. Live data files are never candidates. | `--dry-run`, `--yes`, `--images` |
| `rotate-keys session\|vapid` | Backup (mandatory), impact warning, confirmation, delete `data/secret` or `data/vapid.json`, restart the API, check that a new key file exists. `session` = instance-wide logout; `vapid` = every user must re-enable notifications. | `--dry-run`, `--yes` |
| `rollback TAG` | Pins api and web images to `X.Y.Z` or `sha-<short>` through a generated `docker-compose.override.yml` (marker-protected, a foreign override is never touched), pulls, restarts, waits for health. `update` refuses to run while a pin is active. | `--clear`, `--with-data ARCHIVE`, `--dry-run`, `--yes` |
| `schedule install\|remove\|show` | Marked block in your crontab (other entries untouched, one block per folder): daily backup, `monitor` every N minutes, monthly report when the stats suite exists. `--system` writes `/etc/cron.d/opengym-<id>` instead; `show --systemd` prints timer units. | `--backup-time HH:MM`, `--monitor-every N`, `--no-backup`, `--no-monitor`, `--system`, `--user NAME`, `--yes` |

Notes:

- **Alert keys.** `monitor` uses `mon-<check id>` (for example `mon-docker`, `mon-users`, `mon-backup`), `backup` uses `backup-failed`
  and `backup-offhost`, `update` uses `update-failed`, `rollback` and `restore` use `*-health`. All follow `ALERT_COOLDOWN` and
  send a "recovered" notice when the condition clears.
- **User-count reference.** `monitor` keeps the highest count seen in `.opengym-state/users` and never lowers it silently. After a
  deliberate change run `opengym monitor --accept-users`.
- **TLS.** The certificate check runs only when `ORIGIN` is `https://` on a real host (`openssl` required, 10 s timeout): warning under
  14 days, failure under 3 days.
- **Rotating keys** leaves the old key inside the backup taken just before: delete older backups if the key was compromised.
- **Cron environment.** `schedule` writes the current `PATH` into the block so `docker` is found by cron.

## Conventions

| | |
|---|---|
| Exit codes | `0` OK · `1` error · `2` usage · `10` degraded / warning · `20` critical (cron and supervisors can act on them) |
| Flags | `--help`, `--dry-run` (any destructive action), `--yes` (skip confirmation), `--json` (machine output) |
| Behaviour | idempotent; `umask 077` for anything that may hold user data; secrets (`data/secret`, `vapid.json`, cookies, push keys, invite codes) are never logged, alerted or read by stats |
| Output | messages on stderr, data on stdout |

## Configuration

Precedence: **environment variable → `opengym.conf` → `.env` → default**. Copy
[`opengym.conf.example`](../../opengym.conf.example) to `opengym.conf` (git-ignored). The files are *parsed*, never
sourced: `KEY=$(command)` stays a literal string. `.env` is only read for the keys the API already uses
(`RP_ID`, `ORIGIN`, `WEB_PORT`, `ADMIN_UIDS`, `INVITE_ONLY`), so script settings never reach the API.

| Key | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Where archives go. Relative paths are under the repo. |
| `BACKUP_KEEP_DAYS` | `30` | Retention. |
| `BACKUP_MAX_AGE_HOURS` | `48` | `status` and `monitor` warn when the last backup is older. |
| `BACKUP_ENCRYPT_TO` | empty | `age` recipient; when set, archives are `.tgz.age`. |
| `BACKUP_OFFHOST_CMD` | empty | Command run with the archive path as `$1` after each backup. |
| `BASE_URL` | `http://127.0.0.1:${WEB_PORT:-8080}` | Used by health checks. |
| `ALERT_WEBHOOK_URL` | empty | Enables the webhook channel. |
| `ALERT_EMAIL_TO` | empty | Enables the email channel. |
| `ALERT_DESKTOP` | `auto` | `auto`, `on` or `off`. |
| `ALERT_COOLDOWN` | `3600` | Seconds a given alert key stays muted. |
| `DISK_WARN_PCT` / `DISK_CRIT_PCT` | `80` / `92` | Disk thresholds (warn must be lower than crit). |
| `STATE_WARN_KB` | `900` | `state-*.json` size warning (nginx limit is 1 MB). |
| `LOG_FILE` | `./logs/opengym.log` | Log destination. |

Environment only (not in `opengym.conf`): `LOG_MAX_KB` (default `1024`, log rotation threshold of `prune`), `BACKUP_AGE_IDENTITY` (age private key file used by `restore` and `verify --backup`), `OPENGYM_CRON_D` (directory for `schedule --system`, default `/etc/cron.d`).

Invalid values (non-numeric, `warn >= crit`, unknown `ALERT_DESKTOP`) stop the command with exit code 2 and name the key.

## Alerts

`alert <info|warn|crit> <key> <title> <message>` (in `scripts/lib/alert.sh`) always logs to the console and `LOG_FILE`
and then fans out to the channels you configured. A channel failure only logs a warning; it never changes the exit
code of the calling command.

| Channel | Enabled by | Notes |
|---|---|---|
| Console + log + exit code | always | Log lines are `ISO-8601Z LEVEL message`, file mode `0600`. |
| Webhook | `ALERT_WEBHOOK_URL` | `POST` with a 5 s timeout, `Content-Type: application/json`, body `{"level","title","message","host","time"}`. Works with Discord/Slack relays, ntfy, Healthchecks or your own endpoint. |
| Desktop | `ALERT_DESKTOP` | macOS `osascript`, Linux `notify-send`. `auto` skips headless sessions (no `DISPLAY`/`WAYLAND_DISPLAY`, or an SSH login on macOS). |
| Email | `ALERT_EMAIL_TO` | `sendmail -t` or `mail`. Without either, one warning is logged and email is skipped. |

Anti-spam: `warn` and `crit` alerts are muted per key for `ALERT_COOLDOWN` seconds (state in `.opengym-state/alerts/`);
`info` is never muted. `alert_clear <key>` sends one "recovered" `info` alert when a key that was alerting returns to
normal. Values of `secret`, `token`, `cookie`, `password`, `vapid` and `gymsid` keys are masked (`***`) in logs and alerts.

Quick manual test of a webhook:

```bash
ALERT_WEBHOOK_URL=http://127.0.0.1:9000/hook bash -c '. scripts/lib/alert.sh; alert warn test "Hello" "from opengym"'
```

## Shared libraries (`scripts/lib/`)

| File | Provides |
|---|---|
| `common.sh` | strict mode, `OPENGYM_ROOT`, `info/ok/warn/die/die_usage`, `require_cmd`, `confirm`, `os_name`, `file_mode`, `secure_umask` |
| `config.sh` | `load_config` (precedence and validation above) |
| `log.sh` | `log_debug/info/warn/error`, `redact` (`OPENGYM_DEBUG=1` shows debug, `OPENGYM_QUIET=1` silences the console for cron) |
| `compose.sh` | `compose_cmd`, `daemon_up`, `svc_running`, `svc_restart_count`, `wait_health` |
| `alert.sh` | `alert`, `alert_clear`, `json_escape` |

## Tests and lint

```bash
bash scripts/tests/run.sh           # all tests, pure bash, no Docker needed
/bin/bash scripts/tests/run.sh      # same under the system bash (3.2 on macOS)
shellcheck -S warning scripts/opengym scripts/TEMPLATE.sh scripts/fetch-media.sh scripts/*/*.sh scripts/tests/mocks/*
```

Tests run in a sandbox with fake `docker`, `curl`, `osascript`, `notify-send`, `sendmail` and `mail` placed first on
`PATH` (they record their calls in `$MOCK_LOG`; override behaviour with `MOCK_EXIT_<NAME>[_<ARG>]` and `MOCK_OUT_<NAME>[_<ARG>]`).
CI runs both on Ubuntu and macOS (`Scripts (shellcheck + tests)` job).
