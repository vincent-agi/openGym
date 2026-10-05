# Operations runbook

Day-2 operations for an openGym instance managed with Docker Compose. Commands assume you are in the project
directory.

## At a glance

> The [`opengym` CLI](automation.md) automates these tasks. The raw commands below stay the reference for what the scripts do.
>
> | Task | CLI |
> |---|---|
> | Status | `opengym status` (`--json`; exit 0 / 10 attention / 20 problem) |
> | Start / stop / restart | `opengym start`, `opengym stop [--down]`, `opengym restart [service]` |
> | Logs | `opengym logs [service]` (`--errors` for problems only) |
> | Backup | `opengym backup` (`--consistent`, `--quiet` for cron) |
> | Restore | `opengym restore <archive>` (`--dry-run`) |
> | Update | `opengym update` (`--dry-run`) |

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Liveness | `curl -fsS http://127.0.0.1:8080/api/health` |
| Logs (follow) | `docker compose logs -f --tail=100 api web` |
| Restart API | `docker compose restart api` |
| Update | `git pull && docker compose pull && docker compose up -d` |
| Backup | `tar czf opengym-$(date +%F).tgz data/` |
| Resource use | `docker stats --no-stream` |

## Health and monitoring

### Liveness

`GET /api/health` returns `{"ok":true,"users":N}` as long as the process answers. It does **not** verify that the data
volume is writable or `db.json` is healthy. For an uptime monitor check both the front door and the API:

```bash
curl -fsS -o /dev/null https://gym.example.com/                # nginx + static app
curl -fsS https://gym.example.com/api/health | jq -e '.ok == true'
```

Alert if the user count **drops** between checks — that is the signature of the `db.json`
[reset failure mode](data-model.md#integrity-and-failure-modes). A cheap check:

```bash
n=$(curl -fsS https://gym.example.com/api/health | jq .users)
last=$(cat /var/lib/opengym-users 2>/dev/null || echo 0)
[ "$n" -lt "$last" ] && echo "ALERT: user count fell $last -> $n"
echo "$n" > /var/lib/opengym-users
```

### What to watch

| Signal | Why | How |
|---|---|---|
| Container restarts | Crash loops. | `docker inspect -f '{{.RestartCount}}' $(docker compose ps -q api)` |
| Disk space on the `data/` volume | A full disk makes every write fail (500). | `df -h data/` |
| `state-*.json` sizes | >1 MB trips the nginx body limit ([why](deployment.md#request-size)). | `find data -name 'state-*.json' -size +900k` |
| Stray `*.tmp` in `data/` | A write was interrupted. | `find data -name '*.tmp'` |
| TLS certificate expiry | Passkeys stop working without HTTPS. | Your proxy / monitoring. |
| HTTP 4xx/5xx rate at the proxy | Abuse, misconfiguration, 413s. | Proxy access log. |
| Push send failures | Stale subscriptions, bad VAPID subject. | `docker compose logs api \| grep 'push send failed'` |

### Logs

The API logs to stdout/stderr only:

| Line | Meaning |
|---|---|
| `gym-api on :3000 (rpID=…, origin=…)` | Startup; confirms the effective `RP_ID` and `ORIGIN`. |
| `<METHOD /path> <stack>` | An unhandled exception in a route (the client got 500). |
| `push send failed <uid> <status> <body>` | A push could not be delivered. 404/410 subscriptions are auto-removed. |

There are **no access logs and no audit log**. Who signed in, who was disabled, who generated invites — none of it is
recorded by the app. Use the reverse proxy's access logs for request-level history. Configure Docker log rotation
(see the [override](deployment.md#hardened-compose-override)) so container logs cannot fill the disk.

Do not log full `Cookie` headers at the proxy: `gymsid` is a bearer credential.

## Backup and restore

Everything stateful is in `./data` (the exercise media is re-downloadable and is **not** user data).

### What to back up

| Path | Required | Notes |
|---|---|---|
| `data/db.json` | **Yes** | Users and passkeys. Without it nobody can sign in. |
| `data/state-*.json` | **Yes** | All user data. |
| `data/secret` | Recommended | Without it, restoring invalidates all sessions (users just sign in again). |
| `data/vapid.json` | Recommended | Without it, all push subscriptions die and users must re-enable notifications. |
| `.env` | **Yes** | `RP_ID` and `ORIGIN` must be restored **exactly**, or every passkey fails. |
| `media/` | No | Re-fetched automatically when `media/img` is empty. |

### Consistent backup

Because writes are atomic renames, a plain copy of the folder is **crash-consistent per file**, but a copy taken
across a multi-file operation could pair a newer `db.json` with an older state file. For a coherent snapshot:

```bash
# brief stop (seconds) — the simplest guarantee
docker compose stop api
tar czf "/backups/opengym-$(date +%F-%H%M).tgz" data/ .env
docker compose start api
```

Or take a live backup and accept per-file consistency (fine for most self-hosters):

```bash
tar czf "/backups/opengym-$(date +%F-%H%M).tgz" data/ .env
```

Filesystem or LVM/ZFS/btrfs **snapshots** of the volume give an atomic point-in-time copy without stopping anything.

### Schedule and retention

```cron
# /etc/cron.d/opengym-backup — daily at 03:15, keep 30 days
15 3 * * *  root  cd /srv/openGym && tar czf /backups/opengym-$(date +\%F).tgz data/ .env && find /backups -name 'opengym-*.tgz' -mtime +30 -delete
```

- Keep at least one copy **off the host**.
- **Encrypt** off-host copies (for example `age` or `gpg`): the archive contains every user's data and the session
  signing key.
- Restrict permissions: `chmod 600` the archive, `umask 077` in the script.
- **Test a restore** at least once, on a scratch machine.

### Restore

```bash
docker compose down
mv data data.broken.$(date +%F)        # keep, do not delete yet
tar xzf /backups/opengym-2026-10-05.tgz     # restores data/ and .env
jq empty data/db.json && echo "db.json OK"
for f in data/state-*.json; do jq empty "$f" || echo "BAD $f"; done
docker compose up -d
curl -fsS http://127.0.0.1:8080/api/health
```

Sanity checks after restoring: the user count in `/api/health` matches expectations, one known account can sign in,
and a workout log shows the expected latest date.

Restoring a **single user**: stop the API only if you also touch `db.json`; to roll back one person's data just copy
their `state-<uid>.json` from the backup (ask them to close the app first, then bump `_ts`; see
[Editing a profile by hand](data-model.md#editing-a-profile-by-hand)).

### Per-user exports

Every user can export their own data as JSON from **Settings → Data**. This is independent of server backups and is
the supported way to move a user between instances (import into the other instance).

## Upgrades

1. Read `CHANGELOG.md` for the target version.
2. Back up (above).
3. `git pull && docker compose pull && docker compose up -d`.
4. Verify: `docker compose ps`, `/api/health`, sign in, run through a short workout, check the logs for errors.
5. If something is wrong, [roll back](deployment.md#rollback) by pinning the previous tag. Restore data only if a release
   corrupted it.

Updating the **base images** (Node, nginx) happens by re-publishing: Dependabot opens PRs for the Dockerfiles, CI
rebuilds and Trivy-scans, and a new image is published on merge. You get it with the next `docker compose pull`.

## Common administration tasks

| Task | How |
|---|---|
| Create the first admin | Register a profile, read its id (`jq -r '.users[].id' data/db.json`), put it in `ADMIN_UIDS`, `docker compose up -d`. |
| Turn on invite-only | `INVITE_ONLY=1` in `.env`, `docker compose up -d`; generate codes in **Settings → Admin dashboard**. |
| Instance-wide logout | `rm data/secret && docker compose restart api` (a new key is generated). |
| Rotate the session key | Same as above. Users re-authenticate with their passkeys. |
| Rotate VAPID keys | `rm data/vapid.json && docker compose restart api`; users must re-enable notifications. |
| Change the domain | **Not supported without data loss**: passkeys are bound to `RP_ID`. A new `RP_ID` means every user registers a new profile and imports their JSON backup (or you transplant state files, see [data-model](data-model.md#recover-a-user-who-lost-their-passkey)). |
| Re-download exercise media | `rm -rf media/img/* media/gif/*` then `docker compose up -d` (or `./scripts/fetch-media.sh`). |
| Free space | Truncate Docker logs, `docker system prune` (careful), remove `data.bak.*` copies. |

## Troubleshooting

| Symptom | Likely cause | Check / fix |
|---|---|---|
| No passkey prompt on phone | Page is not HTTPS, or not the `RP_ID` host. | Browser address bar; fix TLS / domain. |
| `verification failed: …` on login/register | `ORIGIN` or `RP_ID` ≠ the URL in the browser (scheme, host or **port**), or a proxy rewrites the host. | Startup log line shows effective values. Fix `.env`, `docker compose up -d`. |
| `unknown passkey — create a profile first` | Credential not in `db.json`: wrong server, restored an old backup, or `db.json` was reset. | `jq '.creds|length' data/db.json`. |
| **All users suddenly unknown / user count 0** | `db.json` was unreadable at start and overwritten. | Stop the API; restore `db.json` from backup; see [integrity](data-model.md#integrity-and-failure-modes). |
| Users stay signed out after restart | `data/secret` is not persisted (volume missing) → new key each start. | Check the bind mount; `ls -l data/secret`. |
| Sync stopped for one heavy user | State > 1 MB hitting nginx's 413. | `ls -lS data/state-*.json`; raise `client_max_body_size`. |
| 502/504 on `/api/*` | `api` container down or restarting. | `docker compose ps`, `docker compose logs api`. |
| `web` fails to start, `media` exited non-zero | No network to GitHub on first start. | `docker compose logs media`; run `./scripts/fetch-media.sh` on a networked host and copy `media/`. |
| Exercise images missing (404 on `/img/…`) | `media/` empty or not mounted. | `ls media/img | head`; re-run `media`. |
| Rest-timer push never arrives | Not subscribed, tab was foreground, or provider rejected VAPID subject. | `grep 'push send failed'`; set `VAPID_SUBJECT=mailto:…`; resubscribe. |
| Day reminder at wrong time | Stale time zone in the user's state. | User toggles the reminder off/on (re-stamps `reminder.tz`). |
| Sign-in succeeds but the user is immediately signed out | `ORIGIN` is `https://…` (so the cookie is `Secure`) but the browser reaches the site over plain HTTP and drops the cookie. | Serve HTTPS to the browser; redirect HTTP→HTTPS at the proxy. |
| `docker compose pull` → `denied` | GHCR packages private or not yet published. | Build locally: `docker compose up -d --build`. |
| Admin dashboard missing | User id not in `ADMIN_UIDS`, or env not reloaded. | `docker compose up -d` after editing `.env`; confirm `GET /api/me` shows `admin:true`. |
| Disk filling up | Container logs without rotation, many `*.tmp`, backups on the same disk. | `du -sh /var/lib/docker/containers/* data backups`. |

## Disaster recovery checklist

1. Provision a host with Docker and the Compose plugin.
2. `git clone` the repository (or restore your deployment folder and override file).
3. Restore `.env` and `data/` from the latest backup. **Same `RP_ID` and `ORIGIN`.**
4. Point DNS/TLS at the new host.
5. `docker compose up -d`; confirm `/api/health` shows the expected user count.
6. Have one user sign in and verify their latest workout.
7. Re-enable monitoring and backups.

RPO equals your backup interval; RTO is typically minutes. There is no replication or failover.
