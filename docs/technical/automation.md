# Automation scripts (`opengym` CLI)

One entry point, `scripts/opengym`, runs the maintenance, monitoring and reporting scripts for an openGym instance managed
with Docker Compose. Platform: **bash on macOS and Linux** (bash 3.2 compatible). Design:
[`docs/superpowers/specs/2026-10-05-automation-scripts-design.md`](../superpowers/specs/2026-10-05-automation-scripts-design.md).

> Status: the **foundation** and the **user suite** are in place. The `ops` and `stats` suites are delivered by later
> sub-projects.

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
| `ops` | Admins, technical self-hosters | `doctor monitor verify prune rotate-keys rollback schedule` (planned) |
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
