# Foundation (sub-project 1) — implementation plan

Spec: `docs/superpowers/specs/2026-10-05-automation-scripts-design.md` (§2, §3, §8).
Goal: dispatcher, shared libs, config, pure-bash test runner, CI lint job, docs skeleton. No user/ops/stats commands yet,
except one trivial `status`-free probe command (`version`) used to prove the dispatcher end to end.

Method: TDD. Each task = write failing test, run (red), implement, run (green), `shellcheck`, next.
Constraints: bash 3.2 compatible, `set -euo pipefail`, `shellcheck` clean, no `mapfile`, no associative arrays.
Run all tests with `bash scripts/tests/run.sh`.

## Task 1 — Test runner and mocks

Files: `scripts/tests/run.sh`, `scripts/tests/helpers.sh`, `scripts/tests/mocks/{docker,curl,osascript,notify-send,sendmail}`,
`scripts/tests/fixtures/`.

- `helpers.sh`: `assert_eq <expected> <actual> <msg>`, `assert_exit <code> <msg> -- <cmd…>`, `assert_contains <needle> <haystack> <msg>`,
  `assert_file <path>`, `new_sandbox` (mktemp dir, exports `GYMME_ROOT`, copies fixture, prepends `mocks/` to `PATH`, trap cleanup).
- Every mock appends `"$(basename "$0") $*"` to `$MOCK_LOG` and exits with `${MOCK_<NAME>_EXIT:-0}`; `docker` also prints
  `$MOCK_DOCKER_OUT` when set; `curl` prints `$MOCK_CURL_OUT`.
- `run.sh`: sources helpers, executes every `scripts/tests/test_*.sh` in a subshell, counts pass/fail, prints failing assertion
  with file and line, exits 1 on any failure.
- Fixtures: `data_ok/` (valid `db.json` + one `state-*.json`), `data_corrupt_db/`, `data_big_state/`, `data_tmp_orphan/`.
- Self-test `test_runner.sh`: a deliberate pass, and a check that a failing assertion makes the runner exit non-zero
  (run a nested runner on a temp failing test).

Done when: `bash scripts/tests/run.sh` prints `1 file, N assertions, 0 failed`.

## Task 2 — `lib/common.sh`

Test `test_common.sh` first:
- `die "msg"` writes `msg` to stderr, exits 1; `die_usage` exits 2.
- `require_cmd jq` passes when present, exits 1 with an install hint naming the OS when `PATH` is empty.
- `confirm "q"` returns 0 on `y`, 1 on `n`/empty; returns 0 without reading when `ASSUME_YES=1`; returns 1 without a TTY unless `ASSUME_YES=1`.
- `GYMME_ROOT` resolves to the repo root from any working directory and from a symlinked invocation.
- Colours disabled when stderr is not a TTY or `NO_COLOR` is set.

Implement: strict mode, `GYMME_ROOT` via `BASH_SOURCE` + symlink resolution loop (no `readlink -f`, absent on macOS), `info/warn/die/die_usage`,
`require_cmd`, `confirm`, `os_name` (`macos|linux|other`), `umask 077` helper `secure_umask`.

## Task 3 — `lib/config.sh`

Test `test_config.sh` first, using sandbox files:
- Defaults applied when nothing is set (`BACKUP_DIR=$GYMME_ROOT/backups`, `BACKUP_KEEP_DAYS=30`, `ALERT_COOLDOWN=3600`, `DISK_WARN_PCT=80`, `DISK_CRIT_PCT=92`, `STATE_WARN_KB=900`).
- Precedence: env var beats `gymme.conf` beats `.env` beats default (one assertion per pair).
- `BASE_URL` defaults to `http://127.0.0.1:${WEB_PORT:-8080}` and follows `WEB_PORT` from `.env`.
- Parser is not `source`: `gymme.conf` line `FOO=$(touch pwned)` must not execute; quoted values and `#` comments handled; unknown keys ignored.
- Missing files are fine. Non-numeric `BACKUP_KEEP_DAYS` exits 2 with the key name.

Implement `load_config`: line parser (`KEY=value`, optional quotes, strips inline comments only when preceded by space), whitelist of known keys,
numeric validation, exports. `.env` parsed with the same parser but only for the API keys `RP_ID ORIGIN WEB_PORT ADMIN_UIDS INVITE_ONLY`.
Ship `gymme.conf.example` (every key commented with default) and add `gymme.conf`, `backups/`, `logs/`, `reports/`, `.gymme-state/` to `.gitignore`.

## Task 4 — `lib/log.sh`

Test `test_log.sh` first:
- `log_info` appends `YYYY-MM-DDTHH:MM:SSZ INFO message` to `$LOG_FILE`, creating the directory (mode 0700).
- `log_debug` hidden unless `GYMME_DEBUG=1`.
- Stderr output carries colour only on a TTY.
- A message containing `data/secret` contents is not special-cased, but `log_*` redacts values for keys matching `(secret|token|cookie|password|vapid)=` to `***`.
- Log file mode is 0600.

Implement the above with `date -u` (portable) and a small `sed` redaction.

## Task 5 — `lib/compose.sh`

Test `test_compose.sh` first, with the `docker` mock:
- Detects `docker compose` when `docker compose version` exits 0, else `docker-compose`, else exits 1 with message.
- `compose_cmd` runs from `GYMME_ROOT` and forwards args (assert against `$MOCK_LOG`).
- `daemon_up` returns 1 when `docker info` mock fails.
- `svc_running api` true when `ps --status running -q api` returns an id; `svc_restart_count api` parses `docker inspect` output.
- `wait_health <url> <timeout>` returns 0 on first success, 1 after timeout (use `WAIT_STEP=0` in tests, no real sleep).

## Task 6 — `lib/alert.sh`

Test `test_alert.sh` first, one case per rule:
- `alert warn k t m` logs even with no channel configured and returns 0.
- Webhook: `curl` mock invoked once with `-X POST`, `--max-time 5`, the URL, and a JSON body that `jq` parses with `level,title,message,host,time`; JSON-escapes quotes and newlines in the message.
- Webhook failure (`MOCK_CURL_EXIT=22`) logs a warning and the function still returns 0.
- Desktop: `osascript` called on macOS (`os_name` stubbed), `notify-send` on Linux, skipped when `ALERT_DESKTOP=off` or when `auto` and no `DISPLAY`/GUI session.
- Email: `sendmail` called when `ALERT_EMAIL_TO` set; when no mail binary exists a single warning is logged and the next call stays quiet.
- Cooldown: second identical key within `ALERT_COOLDOWN` is suppressed (no channel calls); different key not suppressed; after cooldown (simulate by editing the state file mtime/value) it fires again.
- Recovery: `alert_clear <key>` after a muted alert sends exactly one `info` "recovered" alert and removes state; calling it again sends nothing.
- No secret leaks: message containing `cookie=abc` is redacted in the webhook body.

Implement with state dir `$GYMME_ROOT/.gymme-state/alerts/<key>` holding the epoch of last send; keys sanitised to `[A-Za-z0-9_.-]`.

## Task 7 — Dispatcher `scripts/gymme`

Test `test_dispatch.sh` first, on a sandbox tree with fake commands `scripts/user/hello.sh` (`# desc: say hello`, exits 0), `scripts/ops/boom.sh` (exits 20):
- `gymme hello` runs it and exits 0; `gymme boom` propagates exit 20.
- `gymme help` lists `hello` under `user` and `boom` under `ops` with descriptions, sorted; exits 0. No args behaves like `help`.
- `gymme nope` exits 2 and prints `unknown command: nope` plus close matches (prefix match is enough).
- `gymme hello --help` is passed through to the script (script owns its usage).
- Invoked through a symlink (`ln -s … /tmp/x/gymme`) still finds scripts.
- `gymme --version` prints the version from `.release-please-manifest.json` (`jq -r '.["."]'`), falls back to `unknown`.
- Two scripts with the same name in different suites: dispatcher exits 1 with an explicit ambiguity message (fail loudly).
- A script without `# desc:` is flagged by `gymme help --check` (exit 1), used by CI to guarantee no orphan.

Implement: resolve root, build command index from `scripts/{user,ops,stats}/*.sh`, `exec bash "$script" "$@"`, load libs lazily
inside scripts (dispatcher itself only needs `common.sh`).

## Task 8 — Probe command `scripts/user/version.sh`

`# desc: Show gymme and component versions` — prints gymme version, docker compose version (or `n/a`), `jq`, `curl` versions.
Test: runs under mocks, exit 0, output contains the version. Exists to prove dispatcher + libs wiring; later commands follow the same template.
Add `scripts/TEMPLATE.sh` documenting the standard command skeleton (header, `--help`, `--dry-run`, `--yes`, `--json`, exit codes).

## Task 9 — CI job

Edit `.github/workflows/ci.yml`: new job `scripts` on `ubuntu-latest` and a `macos-latest` matrix entry (bash 3.2):
`shellcheck scripts/gymme scripts/lib/*.sh scripts/*/*.sh scripts/tests/*.sh`, `bash scripts/tests/run.sh`, `scripts/gymme help --check`.
Keep the existing jobs untouched. Check `docs/technical/ci-cd.md` for the branch-protection required-checks list and add the new job name there
(do not change repository settings; mention it in the PR).

## Task 10 — Docs skeleton

- `docs/technical/automation.md`: purpose, install (`ln -s`/PATH tip), command index (empty tables for the three suites, filled by later sub-projects),
  exit codes, config table (copy of spec §3), alert setup (webhook JSON shape, desktop, email), testing instructions.
- `docs/technical/README.md` and `docs/README.md`: add a link.
- `docs/technical/operations.md`: one note at the top of "At a glance" pointing to `gymme` equivalents (table filled later).
- `CONTRIBUTING.md`: short "Scripts" paragraph (shellcheck, bash 3.2, run the test runner).

## Verification (end of sub-project)

1. `bash scripts/tests/run.sh` green, `shellcheck` clean on both Linux and macOS.
2. `scripts/gymme help`, `--version`, `version` work from another directory and via symlink.
3. `ALERT_WEBHOOK_URL` pointed at a local `nc -l`/python listener receives the expected JSON on a manual `alert` call.
4. `git status` shows only intended files; `gymme.conf`, `logs/`, `backups/`, `.gymme-state/` are git-ignored.

## Out of scope here

All user/ops/stats commands, systemd units, the Docker smoke test in CI (sub-project 2), API changes.

## Execution

Suggested: one commit per task using conventional commits (`feat(scripts): …`, `ci: …`, `docs: …`) on a feature branch, one PR for the
whole sub-project (release-please derives the changelog from the commit types).
