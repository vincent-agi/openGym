# User suite (sub-project 2) — implementation plan

Spec: `docs/superpowers/specs/2026-10-05-automation-scripts-design.md` §4. Builds on the foundation plan
(`2026-10-05-foundation.md`). Same method: TDD, bash 3.2, `shellcheck -S warning`, tests in `scripts/tests/`, no Docker needed
(mocks). Commands live in `scripts/user/`.

## Task 1 — Shared data helpers and config key
- `lib/data.sh`: `json_valid`, `validate_data_dir <dir>` (db.json required and valid, every `state-*.json` valid, prints bad files),
  `user_count <dir>`, `sha256_of`, `human_size`, `disk_used_pct <path>`, `env_value <file> <KEY>`, `last_backup_epoch`, `record_backup`.
- `lib/compose.sh`: `fetch_health` (GET `$BASE_URL/api/health`).
- `config.sh`: new key `BACKUP_MAX_AGE_HOURS` (default 48), used by `status` now and `monitor` later.
- Tests: `test_data.sh`, additions to `test_config.sh`.

## Task 2 — `start`, `stop`, `restart`
`start` (`--no-wait`, `--timeout N`): Docker/daemon check, `compose up -d`, wait for `/api/health`, print URL. `stop` (`--down` removes containers,
never data) and `restart [service]` (+ health wait). Mocks verify the compose calls and exit codes.

## Task 3 — `status`
Services, health, user count, last backup age, disk %, one-line verdict. `--json`. Exit 0 OK / 10 attention / 20 problem.

## Task 4 — `backup`
`data/` + `.env` (never `media/`, never `*.tmp`), `umask 077`, optional consistent snapshot (stop api, always restart), optional `age`
encryption, `.sha256`, retention, off-host hook, `.gymme-state/last-backup`, alert on failure, `--dry-run`, atomic write via `.partial`.
Mock `age` for tests.

## Task 5 — `restore`
Checksum, optional decrypt, unsafe-path rejection, JSON validation of the archive **before** touching anything, `RP_ID`/`ORIGIN` comparison,
confirmation, stop stack, current `data/` → `data.broken.<ts>` (never deleted), swap, start, health, user-count sanity, recovery hint on failure,
`--dry-run`.

## Task 6 — `update`
Pre-update backup, show upstream CHANGELOG entry, confirmation, `git pull --ff-only` (when a clone), `compose pull` (fallback `--build`), `up -d`,
health wait, user-count drop check, rollback instructions + crit alert on failure. `--yes --dry-run --no-backup --no-git`.

## Task 7 — `logs`
Follow by default; `--tail N`, `--no-follow`, `--errors` (filters stack traces, route errors, `push send failed`).

## Task 8 — `install`
Checks dependencies, creates `.env` from `.env.example` (never overwrites), prompts or takes `--rp-id/--origin`, validates, warns about passkey
binding and HTTPS, creates `data/` and `backups/`, prints the cron line for daily backup and the next step.

## Task 9 — Docs and wrap-up
`automation.md` command table and per-command reference, `SELF_HOSTING.md` section, `operations.md` equivalents table, full test run on bash 3.2 and 5,
shellcheck, `help --check`.
