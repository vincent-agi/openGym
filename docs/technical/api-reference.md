# API reference

Base path `/api`, served by `api/server.js` and reached through nginx on the same origin. All bodies and responses
are **JSON** (`Content-Type: application/json`); responses carry `Cache-Control: no-store`.

There is no versioning, no OpenAPI document and no request-schema validation beyond the checks listed here. The
API is an internal contract between the Gymme frontend and backend — **treat it as unstable between releases**.

## Conventions

### Authentication

Session cookie **`gymsid`**: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age = SESSION_DAYS × 86400`, and `Secure`
when `ORIGIN` starts with `https:`. It is set by `register/verify` and `login/verify`, cleared by `logout` and
`logout/all`. There are no bearer tokens or API keys.

A request is authenticated when the cookie's HMAC is valid, it has not expired, the user exists and is not disabled,
and the embedded session version equals the user's current `sv`. Otherwise endpoints that require a session answer
`401 {"error":"not signed in"}`.

| Level | Meaning |
|---|---|
| **public** | No session needed. |
| **session** | Any signed-in, enabled user. |
| **admin** | Session **and** user is an admin (`ADMIN_UIDS` or `admin: true`). `401` if not signed in, `403 {"error":"forbidden"}` if not admin. |

### Errors

Errors are `{"error": "<message>"}` with these status codes:

| Code | When |
|---|---|
| 400 | Bad input (`name required`, `state required`, `invalid subscription`, `verification failed: …`, `challenge expired — try again`, `not verified`, `already used — cannot revoke`, `cannot disable an admin`). |
| 401 | `not signed in`. |
| 403 | `forbidden`; `a valid invite code is required`; `invite code is no longer valid — ask for a new one`; `this account has been disabled`. |
| 404 | Unknown route (`not found`), `no such user`, `no such code`, `unknown passkey — create a profile first`. |
| 409 | `credential already registered`. |
| 500 | Unhandled exception (`server error`), or `user missing` on login. |

Two input failures do **not** return a 4xx. A **malformed JSON body** makes `readBody` reject with `bad json`, and a
body **over 5 MB** rejects with `body too large` and destroys the connection; in both cases the route throws and the
generic handler logs it and answers `500 {"error":"server error"}` (or the client sees a reset connection). Treat a
500 on a write endpoint as "check the payload" as well as "check the server".

### Limits

Request body ≤ **5 MB**. No other limits: no rate limiting, no pagination, no ETag/If-Match.

## Endpoints

### Health and configuration

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/health` | public | `{"ok":true,"users":<count>}`. Use for liveness checks. Exposes the user count. |
| `GET /api/config` | public | `{"invite_only":<bool>,"social_enabled":<bool>}`. Lets the login screen know whether to ask for a code, and Settings whether to offer the friends module. |

### Identity and sessions

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/me` | session | `{"user":{"id","name","admin"}}`. |
| `POST /api/register/options` | public | Body `{name, code?}`. `name` trimmed, ≤ 40 chars, required. If invite-only, `code` (case-insensitive) must match an unused, unrevoked invite, else 403 — **this endpoint therefore acts as an invite-code oracle**. Returns `{cid, options}` where `options` are WebAuthn creation options and `cid` is a one-shot challenge handle valid 5 minutes. |
| `POST /api/register/verify` | public | Body `{cid, credential}`. Verifies attestation against `ORIGIN`/`RP_ID`, re-checks and burns the invite, creates the user and credential, saves `db.json`, sets the session cookie. Returns `{user}`. |
| `POST /api/login/options` | public | Body `{}`. Returns `{cid, options}` for a discoverable-credential assertion. |
| `POST /api/login/verify` | public | Body `{cid, credential}`. Looks up the credential, verifies the assertion, updates the stored counter, rejects disabled users, sets the session cookie. Returns `{user}`. |
| `POST /api/logout` | public | Clears the cookie **in this browser only**. A copy of the cookie elsewhere stays valid until expiry or revocation. |
| `POST /api/logout/all` | session | Increments `user.sv`, invalidating every cookie for this account on all devices, and clears the cookie here. |

### Data sync

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/data` | session | `{"state": <object>}` — the contents of `state-<uid>.json`, or `{"state": null}` if the file is missing **or unreadable**. |
| `PUT /api/data` | session | Body `{"state": <object>}`. Any JSON object is accepted. The server deletes `state.active`, writes the file atomically and returns `{"ok":true,"ts":<state._ts|null>}`. No schema check; last write wins. |

### Web Push

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/push/public-key` | public | `{"key": <VAPID public key>}`. |
| `POST /api/push/subscribe` | session | Body `{subscription}` (a `PushSubscription.toJSON()` with `endpoint`, `keys.p256dh`, `keys.auth`). Replaces any subscription with the same endpoint. |
| `POST /api/push/unsubscribe` | session | Body `{endpoint}`. Removes this user's subscription for that endpoint. |
| `POST /api/push/test` | session | Sends a test notification to the user's subscriptions. |
| `POST /api/push/rest-timer` | session | Body `{seconds}` (clamped to 1–3600; `0`/non-numeric is clamped up to 1). Schedules one rest-over push, replacing any pending one for the user. |
| `POST /api/push/rest-timer/cancel` | session | Cancels the pending rest-over push. |
| `POST /api/push/pressure-relief` | session | Schedules a pressure-relief push ~5 s later. |
| `POST /api/push/pressure-relief/cancel` | session | Cancels it. |

Pushes are sent with urgency `high`. Subscriptions answering HTTP 404 or 410 are deleted automatically.

The daily "workout planned" reminder has no endpoint: it is produced by the 10-second server loop from each user's
`reminder` settings (see [architecture](architecture.md#background-timers-all-unrefd)).

### Friends & sharing

Registered only when `SOCIAL_ENABLED` is not off; otherwise every path below answers `404 {"error":"not found"}`.
Implemented in `api/social.js`. Unknown JSON fields are rejected with `400`.

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/social/me` | session | `{"social":{enabled, handle, displayName, share:{sessions, streak, consistency, prs}, hideRank}}`. A user who never opened the module gets the private defaults (`enabled:false`, empty handle). |
| `PUT /api/social/me` | session | Partial update of the same object. `handle`: 3-20 chars `[a-z0-9_]`, stored lowercase, unique across the instance (`409` on clash). `displayName`: 1-30 chars, no control characters. `share.*`, `enabled` and `hideRank` must be booleans. `enabled:true` requires a handle and a display name (`400` otherwise); `enabled:false` always succeeds. Returns the stored settings. |

#### Friends

All routes below need a session **and** `social.enabled` (otherwise `403 turn on sharing first`). Implemented in
`api/friends.js`. A friend code is 10 characters from an alphabet without `0 O 1 I L`, valid 14 days, usable by several
people, and revoked when its owner creates a new one.

| Method & path | Description |
|---|---|
| `POST /api/social/friends/code` | Creates (and rotates) the caller's friend code. Returns `{code, expiresAt}`. |
| `GET /api/social/friends` | `{friends:[{handle,displayName,since}], incoming:[…], outgoing:[…], blocked:[{handle}]}`. People who turned sharing off are left out; blocks made *against* the caller are never listed. |
| `POST /api/social/friends/request` | Body `{code}` or `{handle}`. Returns `{status:'pending'|'accepted', friend}`. If the other person had already asked, the two requests meet and the friendship is accepted. **Every refusal returns the same `404 {"error":"nobody can be added with that code or handle"}`**: unknown handle or code, user not sharing, blocked (either way), yourself, duplicate request, already friends. |
| `POST /api/social/friends/respond` | Body `{handle, action:'accept'|'decline'}`. Only the recipient can answer; declining deletes the request. `404` otherwise. |
| `POST /api/social/friends/remove` | Body `{handle}`. Ends an accepted friendship from either side. |
| `POST /api/social/friends/block` | Body `{handle}`. Silent: the blocked user is not told, loses the friendship and can no longer send requests. Always `200`, even for an unknown handle, so it cannot be used to probe handles. |
| `POST /api/social/friends/unblock` | Body `{handle}`. Only the blocker can. |

#### Shared summary

| Method & path | Description |
|---|---|
| `GET /api/social/friends/summary` | Needs a session and sharing. `{me, friends:[{handle, displayName, hideRank, summary, updatedAt, stale}]}`: `friends` are the **accepted** friends who are sharing, and `me` is the caller's own row, built the same way. `hideRank` is true for people who opted out of rankings. `summary` holds only the keys that friend chose to share, or `null` if they have not synced since enabling sharing. `stale` is true when `updatedAt` is older than 14 days. |

The summary is computed by the server (`api/summary.js`) from the state saved with `PUT /api/data`; clients cannot submit one.
Its keys are a fixed whitelist (a test fails if one is added unreviewed):

| Key | Shared with the choice | Meaning |
|---|---|---|
| `weekSessions`, `monthSessions` | Sessions | Sessions this week (Monday to today) and this month. A session is a workout with at least one completed set. Workouts dated after today are ignored. |
| `activeDays`, `lastActiveDate` | Sessions | ISO dates with a session in the last 28 days. No times, routines, exercises or volumes. |
| `weekPlanned`, `weekConsistency` | Consistency | Sessions planned for the whole week (weekly plan plus per-day overrides) and `weekSessions / weekPlanned`, capped at 1; `null` when nothing was planned. |
| `streakWeeks` | Week streak | Consecutive weeks with a session. A week with none *yet* does not break it. |
| `prCount` | Personal records | Records in the last 28 days. |

"Today" is computed in the owner's `reminder.tz` (UTC when unset), so a week boundary does not move for people abroad.
Body weight, measurements, nutrition, effort ratings, the mobility profile, exercise names, weights and reps are never read.

Adding by exact handle does reveal that a *sharing* user with that handle exists. Treat handles as findable by anyone
who has an account on the instance; users who want to stay unlisted should not enable sharing or should add friends by code only.

### Live presence

| Method & path | Auth | Description |
|---|---|---|
| `POST /api/activity` | session | Heartbeat while a workout is on screen. Body `{active:true, name, exIdx, exTotal, setsDone, setsTotal, startedAt}`; `{active:false}` removes the entry. Held in memory for 70 s after the last ping; never persisted. |

### Admin

All require **admin**.

| Method & path | Description |
|---|---|
| `GET /api/admin/users` | `{users:[{id,name,created,disabled,admin,invitedBy,workouts,lastWorkout,lastSync,hasPush,live}], invite_only, now}`. Reads **every** state file. |
| `GET /api/admin/user?id=<uid>` | One user's profile summary, routines, full `bodyweight` and `workouts` (newest first). `404 no such user`. |
| `POST /api/admin/user/disable` | Body `{id, disabled}`. Cannot disable an admin (400). Disabling also removes the user's live presence. |
| `GET /api/admin/invites` | `{invites:[…, usedByName], invite_only}`. |
| `POST /api/admin/invites/new` | Body `{note?}` (≤ 60 chars). Generates a **16-hex-character** code (8 random bytes), unique among existing codes. Returns `{invite}`. |
| `POST /api/admin/invites/revoke` | Body `{code}`. Deletes an **unused** code; used codes cannot be revoked (400). |

## Example: calling the API with curl

Sessions require a WebAuthn assertion produced by a browser or authenticator, so you cannot sign in with curl alone.
For scripted checks use the public endpoints:

```bash
curl -fsS https://gym.example.com/api/health
# {"ok":true,"users":3}

curl -fsS https://gym.example.com/api/config
# {"invite_only":true,"social_enabled":true}
```

To exercise authenticated endpoints, copy the `gymsid` cookie value from a browser session you own and pass it with
`-b "gymsid=…"`. Treat that value as a password.

## Writing a new endpoint

1. Add an entry to the `routes` object in `api/server.js`, keyed `"METHOD /api/path"`.
2. Start with `readSession(req)` (or `requireAdmin(req, res)`) and return early on `null`.
3. Parse input with `await readBody(req)`; validate every field you use — nothing validates for you.
4. Persist with `atomicWrite` (state files) or mutate `db` then `saveDb()` (identity data).
5. Respond with `json(res, status, obj)`.
6. Update this page and `SECURITY.md` if the endpoint is reachable without a session or exposes other users' data.
7. Add a route test in `api/test/` (see [Development → API tests](development.md#api-tests)).
