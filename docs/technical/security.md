# Security guide for DevSecOps

This page complements the root [`SECURITY.md`](../../SECURITY.md) (vulnerability reporting and the maintainers' own
statement of the security model). Here the focus is **what an operator must do** to run Gymme safely, and how to
verify it.

## Summary

Gymme is a small, self-hosted app with a deliberately short list of security features. It is safe for a personal or
family instance **if you supply what it intentionally leaves out**: TLS, rate limiting, security headers, encrypted
backups and host protection.

| Control | Provided by Gymme | You must provide |
|---|---|---|
| Authentication | Passkeys (WebAuthn), server-verified | — |
| Session integrity | HMAC-SHA256 signed cookie, constant-time compare | Keep `data/secret` secret |
| Session revocation | Per-account (`logout/all`), per-user disable, instance-wide (`secret` reset) | Procedures (below) |
| Authorization | Data isolated by session uid; admin routes gated server-side | Decide who is admin |
| Transport security | — | **TLS termination** |
| Rate limiting / brute-force | Limits on the friends routes only (friend requests, code guessing, cheers, challenge creation) | **Reverse-proxy limits** for everything else |
| Security headers (HSTS, CSP…) | — | **Reverse-proxy headers** |
| Encryption at rest | — | Disk/volume encryption, encrypted backups |
| Audit logging | — | Proxy access logs, host auditing |
| CSRF defence | `SameSite=Lax` only | Optionally enforce `Origin` check at the proxy |

## Trust model

- The **operator is fully trusted.** Anyone with read access to `./data` can read every user's history and, with
  `secret`, forge a session for any account (including admin). Users trust you as they would any service host.
- **Admins** (`ADMIN_UIDS` or `admin: true`) can read every user's workouts and body weight, disable accounts, and
  manage invites. They cannot see passkeys' private keys (those never reach the server) and cannot disable other admins
  through the API.
- **Regular users** can only read and write their own `state-<uid>.json` (the uid comes from the session, never from
  the request), and can end all of their own sessions.
- **The network is untrusted.** All client input is untrusted, but note that the API performs **minimal validation**:
  the state document is stored as sent (objects only), and string fields are length-capped only in a few places.

## Threat model

| # | Threat | Assessment | Mitigation |
|---|---|---|---|
| T1 | Credential theft / phishing | Low: passkeys are origin-bound and have no shared secret. | Keep `RP_ID`/`ORIGIN` exact. |
| T2 | Stolen device with an unlocked session | Medium: cookie lasts `SESSION_DAYS` (default 90). | Lower `SESSION_DAYS`; users run **Sign out everywhere**; admins bump `sv` or disable the account. |
| T3 | Session forgery | Low unless `secret` leaks. | Protect `data/`; rotate by deleting `secret`. |
| T4 | Brute-force / credential stuffing | Passkeys cannot be guessed, but **invite codes** can be probed through `register/options`. 64-bit codes make this impractical; old 32-bit codes do not. | Proxy rate limits; **revoke and reissue** any 8-character codes. |
| T5 | Registration abuse (open signup) | A public instance lets anyone create profiles and store ~5 MB each, unbounded in count. | `INVITE_ONLY=1`; proxy limits; periodic review of the user list. |
| T6 | Denial of service | No rate limit, one Node process, full-file rewrites. A flood of registrations rewrites `db.json` repeatedly. | Proxy rate limits and connection limits; WAF; keep the instance off the public internet if it need not be on it (VPN, Tailscale, Cloudflare Access). |
| T7 | Data exfiltration from host | Plaintext JSON. | Disk encryption, tight file permissions, encrypted backups, no world-readable mounts. |
| T8 | XSS in the SPA | React escapes by default; no known sinks, but there is no CSP to limit impact. | Keep dependencies updated; consider a tested CSP at the proxy. |
| T9 | CSRF | `SameSite=Lax` blocks cross-site POST/PUT with cookies. No tokens. | Keep `Lax`; do not add endpoints that mutate state on `GET`. Optionally require a matching `Origin` header at the proxy for `/api/` non-GET requests. |
| T10 | Supply chain (npm, base images, Actions) | Mitigated in CI, see below. | Pin image tags/digests; review Dependabot PRs. |
| T11 | Admin dashboard takeover | An admin account is a passkey profile. | Register admin profiles on hardware-backed passkeys; limit `ADMIN_UIDS` to the minimum. |
| T12 | Push-channel abuse | `vapid.json` private key leak lets an attacker push to subscribers. | Protect `data/`; rotate by deleting `vapid.json`. |
| T13 | Data tampering via `PUT /api/data` | A user can write anything into their own state file (their own data only). | Acceptable; the server never evaluates it. Other users' views (admin dashboard) render it as text. |

## Friends module (v1.7): threat model

The friends module is the only part of Gymme that lets one user's data reach another user. It is therefore built to
share as little as possible, and tested to do so (`api/test/social-authz.test.js`, `privacy-boundaries.test.js`).

**What is shared, and with whom.** A user who never opens the module shares nothing. A user who opts in shares, with
their *accepted friends only*, a small server-computed summary (sessions, consistency against their own plan, week streak,
active days, personal-record count, and a trend against their own past), plus the badges and a fixed emoji cheer they
choose to send or show. Never shared: body weight, measurements, nutrition, effort ratings, the mobility profile, exercise
names, weights, reps, timestamps finer than a day, or planned-break reasons. See [Friends module scoring](social-scoring.md).

**Trust boundaries.**

| Boundary | Rule |
|---|---|
| User ↔ server | The summary, events, progress and badges are computed **by the server** from the saved state. A client cannot submit them, and unknown fields are rejected. |
| User ↔ friend | Friends read derived data from `db.json`, never `state-<uid>.json`. A test fails if any module reads a state file with a uid other than the caller's. |
| User ↔ stranger | Strangers get the same refusal whether a user exists, shares, blocked them or is a duplicate (no enumeration). Handles can only be tried one at a time under a rate limit. |
| Operator | Can read everything in `./data`, as everywhere else. The admin dashboard shows only **counts** of friends and challenges per user. |
| Instance | `SOCIAL_ENABLED=0` removes every `/api/social/*` route (404). |

**Abuse cases and mitigations.**

| Abuse | Mitigation |
|---|---|
| Finding out who uses the instance | Friend codes (10 characters, ~49 bits, 14 days, revocable) and exact handles only; no search or listing. Identical errors for every refusal. Code guessing is limited to 20 attempts an hour per user and per address, with a wait that doubles. |
| Harassment by repeated requests | 10 requests an hour per user and per address; block is silent and removes the friendship, the cheers and the shared challenges. |
| Flooding with cheers or challenges | 60 cheers an hour, 10 challenge creations a day, at most 5 live challenges per person. Cheers are one of five emoji; there is no free text anywhere. |
| Forging scores | Progress is derived server-side; sessions dated in the future are ignored; badges are written only by the server. |
| Leaking through stale data | Turning sharing off, an admin disabling the account, or blocking takes effect on the next request. Events and cheers expire after 30 days. |
| Cross-site scripting through names | Handles, display names and challenge titles are length-capped, stripped of control characters and rendered only as text; a test forbids `innerHTML`/`dangerouslySetInnerHTML` in the app. |
| Notification spam | Opt-in per kind, quiet hours in the recipient's time zone, one friend-session push and three social pushes a day. |

**Leaving.** `POST /api/social/leave` (with `{"confirm":true}`) deletes everything the module stores about the caller
(friendships and blocks, codes, summaries, events, cheers sent and received, mutes, queued pushes, badges, challenge
participation) and resets their settings to the private defaults. Challenges they owned pass to a participant who is still
in, or are cancelled; no user id remains anywhere in `db.json` outside the account records themselves (a test searches for
it). A block made *against* the leaving user is deleted with the rest. Their own training data is not touched. Backups
include the user's own friends settings; importing a backup never restores friends, requests or challenges.

**Limits.** Rate limits are in memory per process and per client address (taken from `X-Real-IP`, which the bundled nginx
overwrites; the client-controlled `X-Forwarded-For` is ignored). Running behind a different proxy requires it to set
`X-Real-IP` to the true client address, or all clients will share one budget.

## Known weaknesses (as designed)

Be aware of these when assessing risk; each is also documented in the root `SECURITY.md`.

1. **`requireUserVerification: false`.** A passkey released without biometric/PIN is accepted. An unlocked
   authenticator is enough.
2. **No rate limiting; invite validity is observable** through `POST /api/register/options`.
3. **No security headers** and no CSP in the shipped nginx.
4. **Plain HTTP between proxy and containers**; fine on loopback or an isolated Docker network, not across hosts.
5. **One passkey per profile, no recovery.**
6. **Unauthenticated disclosure:** `/api/health` reveals the user count; `/api/config` reveals whether invites are
   required; the register/login handshakes answer to anyone.
7. **Session revocation is per account**, not per device.
8. **The app does not validate the shape of the state document**; a malformed state can break that user's client but
   not the server.
9. **`db.json` reset-on-parse-error** can destroy the identity store if the file is corrupted — an integrity and
   availability issue ([details](data-model.md#integrity-and-failure-modes)).

## Hardening checklist

### Network and TLS

- [ ] HTTPS only, valid certificate for the exact `RP_ID`. HTTP redirects to HTTPS.
- [ ] `ORIGIN` is the `https://` URL users see (this also makes the cookie `Secure`).
- [ ] `web` published on `127.0.0.1` (or a private network) only; nothing else reaches port 8080/80.
- [ ] `api` port 3000 is **not** published.
- [ ] HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` set at the proxy
      ([examples](deployment.md#reverse-proxy-and-tls)).
- [ ] Rate limits on `/api/register/*`, `/api/login/*`, and a general `/api/` cap.
- [ ] Request body limit above the API's 5 MB (and above nginx's default 1 MB, see
      [request size](deployment.md#request-size)).
- [ ] Consider an authenticating front (Cloudflare Access, Authelia, VPN) if the instance is for people you know.

### Application configuration

- [ ] `INVITE_ONLY=1` unless open signup is intended.
- [ ] `ADMIN_UIDS` limited to the people who need it. Empty is the safest.
- [ ] `SESSION_DAYS` tuned to the audience (e.g. `30`).
- [ ] Old 8-character invite codes revoked and reissued.
- [ ] `VAPID_SUBJECT` set to an operator-controlled `mailto:`.
- [ ] Image tags **pinned** (ideally by digest), not `latest`.

### Container hardening

The shipped images run the API as **root** and set no `USER`, healthcheck or read-only filesystem. Recommended:

- [ ] Apply the [hardened override](deployment.md#hardened-compose-override): `read_only`, `cap_drop: [ALL]`,
      `no-new-privileges`, memory and PID limits, log rotation.
- [ ] Run the API as a non-root UID (`user: "1000:1000"`) and `chown` `./data` accordingly.
- [ ] Keep Docker and the kernel patched; do not expose the Docker socket to any container.
- [ ] No `privileged`, no host networking.

### Host and data

- [ ] `./data` permissions: `chmod 700 data`; `secret` and `vapid.json` stay `0600`.
- [ ] Full-disk or volume encryption on the host.
- [ ] Backups encrypted, off-host, restore-tested ([operations](operations.md#backup-and-restore)).
- [ ] **Do not commit `data/`.** See the repository hygiene note below.
- [ ] Host firewall allows only 443 (and 80 for redirects/ACME).
- [ ] Unattended security updates on the host.

### Repository hygiene (action recommended)

At the time of writing the repository **tracks `data/db.json`** (one user record and one passkey public key), while
`.gitignore` ignores only `data/secret` and `data/vapid.json`, and `CONTRIBUTING.md` says `data/` is git-ignored. When
you run Compose from a clone, the live `db.json` is that same tracked file, so real user records can be committed by an
accidental `git add -A`. Recommended fix: `git rm --cached data/db.json`, add `data/` to `.gitignore`, and treat the
already-committed record as public (it contains a display name and a public key — no secret — but it is user data).

## Secrets inventory

| Secret | Location | Rotation | Impact of rotation |
|---|---|---|---|
| Session HMAC key | `data/secret` | Delete file, restart | All users sign in again (passkeys unaffected). |
| VAPID private key | `data/vapid.json` | Delete file, restart | Push subscriptions invalid; users re-enable notifications. |
| Passkey private keys | User devices | User-managed | n/a — never on the server. |
| `RELEASE_PLEASE_TOKEN` | GitHub repo secret | Per policy | Release PRs stop triggering CI until replaced. |
| `GITHUB_TOKEN` | Ephemeral (Actions) | Automatic | — |

There are no API keys, database passwords or third-party credentials in the application configuration.

## Supply-chain controls already in the repository

| Control | Where | What it does |
|---|---|---|
| Dependabot | `.github/dependabot.yml` | Weekly grouped PRs for npm (`/frontend`, `/api`), Docker base images (`/api`, `/web`), GitHub Actions. |
| CodeQL | `security.yml` | Static analysis of JS/TS on every PR, push to `main`, and weekly. |
| `npm audit` | `security.yml` | Informational report for everything; **blocking** on high/critical for runtime (`--omit=dev`) dependencies of both packages. |
| gitleaks | `security.yml` | Secret scan across the PR's commit range. |
| Trivy | `publish.yml` | Scans each image; **HIGH/CRITICAL fixable** findings block the push. |
| Branch protection | [`BRANCH_PROTECTION.md`](../BRANCH_PROTECTION.md) | Required checks, review, no force-push. |
| CODEOWNERS | `.github/CODEOWNERS` | Review routing for sensitive paths. |
| Multi-arch, reproducible tags | `publish.yml` | `:X.Y.Z`, `:X.Y`, `:latest`, `:sha-<short>`. |

Gaps you may want to close in your fork: image **signing** (cosign) and **SBOM/provenance** attestations, pinning
GitHub Actions to commit SHAs instead of tags, adding `USER`/`HEALTHCHECK` to the Dockerfiles, and automated API
tests (CI today only checks syntax and that the server boots).

## Verifying a deployment

```bash
# TLS and headers
curl -sI https://gym.example.com/ | grep -iE 'strict-transport|x-content-type|referrer-policy|x-frame'

# Plain HTTP must redirect, not serve
curl -sI http://gym.example.com/ | head -n1

# API port must not be reachable from outside
nmap -p 3000,8080 gym.example.com        # expect closed/filtered

# Unauthenticated access to protected endpoints
curl -s -o /dev/null -w '%{http_code}\n' https://gym.example.com/api/data         # 401
curl -s -o /dev/null -w '%{http_code}\n' https://gym.example.com/api/admin/users  # 401

# Cookie flags after a real sign-in (browser dev tools): HttpOnly, Secure, SameSite=Lax
# Rate limiting actually works (expect 429 or 503 after the burst)
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://gym.example.com/api/login/options -d '{}' -H 'content-type: application/json'; done; echo

# Container posture
docker compose exec api id            # uid=1000 if you ran it unprivileged
docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}' $(docker compose ps -q api)
```

## Incident response

| Incident | Immediate actions |
|---|---|
| **Lost or stolen device** | User: **Sign out everywhere** from another device. Admin: disable the account or increment its `sv`. |
| **Suspected abuse of a profile** | Disable the account (dashboard). Review proxy logs for the uid's activity. |
| **`data/` or a backup leaked** | Treat as full compromise: delete `data/secret` (invalidates forged sessions), delete `data/vapid.json`, restart; notify users that their workout and body-weight history was exposed; rotate any backup keys. Passkey public keys are not secrets. |
| **Open signup being abused** | Enable `INVITE_ONLY=1`, apply proxy rate limits, disable offending accounts, remove empty profiles ([delete a user](data-model.md#delete-a-user-completely)). |
| **Invite code leaked** | Revoke it in the dashboard (works only while unused). |
| **Vulnerable dependency in an image** | Pull the patched image once published (`docker compose pull && up -d`); check `CHANGELOG.md`; if none, rebuild from source after bumping the dependency. |
| **Suspected data corruption** | Stop the API, copy `data/` aside, validate with `jq empty`, restore from backup ([runbook](operations.md#restore)). |

To report a vulnerability in Gymme itself, follow [`SECURITY.md`](../../SECURITY.md).

## Privacy and data protection

- No telemetry, analytics or third-party calls from the self-hosted app. The browser fetches only your own origin; the
  **mobile app** loads exercise media from `cdn.jsdelivr.net`; the separate project website (`website/`) calls the
  public GitHub API for star and fork counts.
- Personal data stored: a **display name** (free text), workout/body-weight/nutrition/measurement history, optional
  Web Push endpoints, and WebAuthn public keys. No email, phone, address or IP is stored by the app. IPs appear only in
  proxy logs you control.
- **Data subject requests:** export = the user's own JSON export; erasure = [delete a user](data-model.md#delete-a-user-completely)
  plus purging backups according to your retention policy; the app has no self-service account deletion.
- If you host Gymme for others in a regulated context, you are the controller: write a retention policy, secure
  backups, and tell users who can read their data (admins and you).
