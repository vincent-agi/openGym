# Data model and storage

Gymme has **no database server**. Persistence is a directory of JSON files (`DATA_DIR`, `/data` in the container,
`./data` on the host). This page is the reference for database administrators: layout, schemas, consistency
guarantees, and how to inspect or repair data safely.

## Directory layout

```
data/
├── db.json                 identity store: users, passkeys, push subscriptions, invites
├── state-<uid>.json        one per user: the user's entire app state (plan, workouts, weight, settings…)
├── secret                  hex string, 32 random bytes: HMAC key for session cookies   (mode 0600)
├── vapid.json              Web Push VAPID key pair {publicKey, privateKey}              (mode 0600)
└── *.tmp                   transient: atomic-write staging files (should never persist)
```

`<uid>` is the user id with every character outside `[a-zA-Z0-9_-]` removed (path-traversal guard), e.g.
`state-piYdx5GveQarq8u9.json`. Ids are 12 random bytes, base64url (16 chars).

Anything else in the folder is ignored by the API.

### Sensitivity

| File | Contains | Compromise impact |
|---|---|---|
| `secret` | Session HMAC key | Attacker can mint a valid cookie for **any** user, including admins. |
| `vapid.json` | Push private key | Attacker can send push notifications to subscribed devices. |
| `db.json` | Names, passkey **public** keys and counters, push endpoints and keys, invite codes | Privacy leak; push endpoints/keys let someone push to those devices. No password-equivalents. |
| `state-*.json` | Complete workout, body-weight, nutrition and measurement history | Privacy leak. **Not encrypted.** |

Nothing in `./data` is encrypted at rest. Use full-disk or volume encryption, and encrypt backups.

## Write semantics

All writes go through `atomicWrite(file, content)`: write `file.tmp`, then `rename` over the target. A `rename` on the
same filesystem is atomic on POSIX, so readers never see a half-written file and a crash leaves either the old or
the new content. **Exceptions:** `secret` and `vapid.json` are created once with a plain `writeFileSync`
(mode `0600`) and never rewritten.

There is **no locking, journaling or fsync**. A power loss immediately after `rename` can still lose the most
recent write on filesystems that reorder metadata and data. The design assumes **one API process**; two writers
race and the last `rename` wins.

`db.json` is held **in memory** after startup. Editing the file on disk while the API runs has **no effect until
restart**, and the next in-app change **overwrites** your edit with the in-memory copy. Always stop the API before
editing `db.json`. `state-*.json` files are read from disk on demand, so they can be read live, but writes
from clients will overwrite manual edits.

## `db.json` schema

```jsonc
{
  "users": [
    {
      "id": "piYdx5GveQarq8u9",          // 16-char base64url, immutable
      "name": "Arvids",                   // display name, ≤ 40 chars
      "created": "2026-08-03T18:06:47.577Z",
      "disabled": true,                   // optional; true = locked out everywhere
      "admin": true,                      // optional; also settable via ADMIN_UIDS
      "invitedBy": "A1B2C3D4E5F60718",    // optional; invite code used
      "sv": 2,                            // optional; session version, see below
      "lastReminder": "2026-10-05",       // optional; ISO date of last day-reminder push
      "social": {                         // optional; friends module settings, absent until first saved
        "enabled": false,                 // master switch; false = invisible to everyone
        "handle": "lea_fit",              // unique, lowercase, 3-20 of [a-z0-9_]
        "displayName": "Léa",
        "share": { "sessions": true, "streak": true, "consistency": true, "prs": false },
        "hideRank": false
      }
    }
  ],
  "creds": [                              // WebAuthn credentials; N:1 to users in practice 1:1
    {
      "id": "C6uzDI9fTw-1bkrKxRrE5A",     // credential id, base64url
      "userId": "piYdx5GveQarq8u9",
      "publicKey": "pQECAyYg…",           // COSE public key, base64url
      "counter": 0,                       // signature counter, updated on each login
      "transports": ["internal", "hybrid"]
    }
  ],
  "friendships": [                        // friends module: one record per pair of users
    {
      "id": "Zx3k9Qw1",
      "a": "piYdx5GveQarq8u9",            // the two user ids, in sorted order
      "b": "v2Lm0ePqRt7YcNaB",
      "status": "accepted",               // "pending" | "accepted" | "blocked"
      "requestedBy": "piYdx5GveQarq8u9",
      "createdAt": 1791370000000,
      "since": 1791371000000,             // accepted only
      "blockedBy": null                   // blocked only: who blocked
    }
  ],
  "friendCodes": [                        // friends module: shareable codes, 14 days
    { "code": "K7QH2MWD4X", "uid": "piYdx5GveQarq8u9", "createdAt": 1791370000000, "expiresAt": 1792580000000 }
  ],
  "subs": [                               // Web Push subscriptions
    {
      "userId": "piYdx5GveQarq8u9",
      "endpoint": "https://fcm.googleapis.com/…",
      "keys": { "p256dh": "…", "auth": "…" },
      "created": "2026-08-04T09:00:00.000Z"
    }
  ],
  "invites": [
    {
      "code": "0F3A9C21B7D84E65",         // 16 hex chars (older: 8 chars). Compared as exact string
      "note": "for Sam",                  // ≤ 60 chars
      "createdBy": "piYdx5GveQarq8u9",
      "created": "2026-09-01T10:00:00.000Z",
      "usedBy": "…",                      // user id once redeemed
      "usedAt": "…",
      "revoked": true                     // optional
    }
  ]
}
```

### Relationships and invariants

| Relationship | Notes |
|---|---|
| `creds.userId → users.id` | A credential without a user logs in with `500 user missing`. Registration always creates one credential per user; there is no API to add more. |
| `subs.userId → users.id` | Orphan subscriptions are harmless. Dead endpoints (HTTP 404/410 from the push service) are removed automatically on send. |
| `friendships.a/b → users.id` | Orphans are harmless. A blocked record is never shown to the blocked user. |
| `friendCodes.uid → users.id` | Expired and revoked codes are refused; creating a new code removes the owner's old ones. |
| `invites.usedBy → users.id` | Redeemed invites cannot be revoked via the API. |
| `state-<uid>.json ↔ users.id` | **No foreign key.** Deleting a user from `db.json` leaves the state file orphaned; deleting the file leaves a user with an empty profile. |
| `disabled` | Checked on every authenticated request and every login. Takes effect immediately, no restart. |
| `sv` | Session version. A cookie is valid only if its embedded version equals `user.sv` (default 0). Incrementing it revokes all cookies for that user. |

Uniqueness is enforced **only in application code** at registration: `creds.id` is checked before insert (409 on
duplicate). `users.id` is random and not checked. Invite `code` uniqueness is checked at creation.

## `state-<uid>.json` schema

The file is the client's `S` object verbatim (see `DEF` in `frontend/src/store/useStore.js`). The server validates
only that it is a JSON **object**; it never inspects the contents, and **deletes the `active` key** before writing.
Clients overlay stored state on top of defaults, so missing keys are normal and old files stay valid.

```jsonc
{
  "_ts": 1759670000000,            // ms epoch of last client change; sync tiebreaker
  "unit": "kg",                    // "kg" | "lb"  (label only; numbers are never converted)
  "restSec": 90, "sound": true, "keepAwake": true, "lang": "en",
  "theme": "dark", "accent": "lime", "body": "male", "gifSize": "full",
  "playlistCue": true,
  "effort": null,                  // null | "none" | "rir" | "rpe"
  "targetW": 75,                   // target body weight or null

  "bodyweight": [ { "d": "2026-10-05", "w": 78.4, "t": 1759670000000 } ],

  "routines": [
    {
      "id": "…", "name": "Push Day", "emoji": "barbell",      // "emoji" holds an icon glyph key
      "prog": "linear",                                         // optional default progression policy
      "playlist": { "provider": "spotify", "url": "https://…" },// optional
      "ex": [
        {
          "id": "0025",                 // exercise id (catalogue id, or generated for custom)
          "sets": 4, "reps": 8, "weight": 60,
          "mode": "reps",               // optional: "reps" | "time" | "cardio"
          "sec": 45, "min": 20, "speed": 8,        // time / cardio fields
          "bodyweight": true, "side": true,        // optional flags
          "prog": "double", "inc": 2.5,            // optional per-exercise policy and step
          "repsMin": 8, "repsMax": 12,             // double progression / bodyweight ceiling
          "sg": "…"                                // superset group id (adjacent items share it)
        }
      ]
    }
  ],
  "week":    { "1": "<routineId>", "3": "<routineId>" },   // 0=Sunday … 6=Saturday
  "dayPlan": { "2026-10-07": "<routineId>|rest" },         // per-date override of the week plan

  "workouts": [
    {
      "id": "…", "d": "2026-10-05", "start": 1759660000000, "end": 1759663600000,
      "routineId": "…", "name": "Push Day", "bw": 78.4,
      "vol": 12450,                                          // total volume, precomputed
      "prs": ["0025", "0027::L"],                            // exercise ids (optionally ::side)
      "sessionRpe": 8,                                       // optional 1–10 rating
      "entries": [
        {
          "id": "0025",
          "target": { "sets": 4, "reps": 8, "weight": 60 },  // what was prescribed (for progression)
          "topW": 62.5,                                      // confirmed working weight
          "sets": [
            { "w": 60, "r": 8, "done": true, "rir": 2 },     // reps set; or rpe, side:"L"|"R"
            { "sec": 45, "w": 0, "done": true },             // timed set
            { "min": 20, "speed": 8, "done": true }          // cardio set
          ]
        }
      ]
    }
  ],

  "exWeights": { "0025": { "w": 62.5, "d": "2026-10-05" } },  // best known working weight per exercise
  "customEx":  [ { "id": "c<uid>", "n": "My exercise", "bp": "chest", "desc": "…", "tg": "", "eq": "custom", "custom": true } ],

  "nutrition": {
    "goal": "cut|maintain|bulk|null",
    "targets": { "kcal": 2400, "protein": 150, "carbs": 280, "fat": 67 },
    "log":      { "2026-10-05": [ { "id": "…", "name": "…", "kcal": 500, "protein": 30, "carbs": 50, "fat": 15, "ts": 0 } ] },
    "mealPlan": { "2026-10-06": [ /* same entry shape */ ] }
  },
  "measurements": { "2026-10-05": { "waist": 82, "chest": 100, "arms": 36, "hips": 95, "bodyFatPct": 18 } },
  "goals": [ { "id": "…", "type": "lift|bodyweight|volume", "exerciseId": "…", "target": 140,
               "deadline": "2026-12-31", "createdAt": 1759670000000, "startValue": 80 } ],

  "reminder": { "on": true, "time": "08:00", "tz": "Europe/Zurich" },   // tz stamped by the client
  "mobilityLevel": null, "disabledLimbs": [], "preferredPosture": null,
  "largeTouchTargets": null, "pressureRelief": { "on": false, "intervalMin": 20 }
}
```

Field sets evolve with releases and are **not versioned** — there is no `schemaVersion`. Treat unknown keys as
forward-compatible additions and do not "clean" them. Dates are ISO `YYYY-MM-DD` strings in the user's local
calendar; instants are epoch milliseconds.

### Size

State grows linearly with logged workouts. As a rough guide, a workout with ~20 sets is on the order of 1–2 KB, so a
heavy daily user reaches 1 MB after a few years. Watch for the nginx 1 MB body limit
([deployment](deployment.md#request-size)): `ls -lS data/state-*.json | head`.

## Integrity and failure modes

These behaviours are intentional simplifications. Know them before you touch the files.

| Situation | What happens |
|---|---|
| `db.json` missing | Treated as a fresh install: empty user list; created on first write. |
| **`db.json` unreadable or invalid JSON** | **The API silently starts with an empty database** (`try { JSON.parse } catch {}`). The next change (any registration, login counter update, admin action) **overwrites the real file with the empty one.** Everyone's passkeys are then gone. **Always validate JSON before starting** (`jq empty data/db.json`) and keep backups. |
| `state-<uid>.json` unreadable/invalid | `GET /api/data` answers `{"state": null}` (parse errors are swallowed). A client with local data then pushes it and overwrites the file; a client with no local data starts empty and overwrites it on its next change. **Restore from backup before the user opens the app.** |
| `secret` deleted | A new one is generated on start; **all sessions are invalidated** (users re-authenticate with their passkeys). Use this as an instance-wide logout. |
| `secret` corrupted/empty | An empty string becomes the HMAC key — sessions still "work" but are trivially forgeable. Delete the file to regenerate. |
| `vapid.json` deleted | New keys generated; **all existing push subscriptions stop working** (they are bound to the old public key) and users must re-enable notifications. |
| Disk full | `writeFileSync` throws → the request returns 500; the `.tmp` file may remain. Free space and delete stray `*.tmp`. |
| Two API processes on one `data/` | Lost updates to `db.json`, broken sign-ins (in-memory challenges). Unsupported. |

## Inspecting data

Read-only queries (safe while running; `db.json` may lag memory only by the last write, which is atomic):

```bash
# users, newest last
jq -r '.users[] | [.id, .name, .created, (.disabled // false), (.admin // false)] | @tsv' data/db.json

# invite codes still unused
jq -r '.invites[] | select(.usedBy|not) | select(.revoked|not) | .code' data/db.json

# a user's workout count and last workout date
jq '{n: (.workouts|length), last: (.workouts[-1].d), bw: (.bodyweight|length)}' data/state-<uid>.json

# which users have push enabled
jq -r '.subs[].userId' data/db.json | sort | uniq -c

# biggest state files
ls -lS data/state-*.json | head
```

## Common administrative operations

> Stop the API for anything that modifies `db.json`: `docker compose stop api`, edit, validate with `jq empty`,
> `docker compose start api`. Take a backup first.

### Make someone an admin

Preferred: set `ADMIN_UIDS=<id>` in `.env` and `docker compose up -d`. No data change.
Alternative: add `"admin": true` to the user object in `db.json` (persists in the file).

### Disable or re-enable an account

Use the in-app admin dashboard, or set `"disabled": true` on the user in `db.json` (API stopped). Disabled users are
rejected immediately on every request and login.

### Force a user to sign in again everywhere

User-initiated: **Settings → Sign out everywhere** (`POST /api/logout/all`). Admin-side: increment `sv` on the user
in `db.json` (API stopped). Instance-wide: delete `data/secret` and restart.

### Delete a user completely

With the API **stopped**, remove the user from `users`, their entries from `creds` and `subs`, then delete
`state-<uid>.json`. Invites they redeemed keep `usedBy` pointing at the old id; this is harmless.

```bash
UID_=piYdx5GveQarq8u9
docker compose stop api
cp -a data data.bak.$(date +%F)
jq --arg u "$UID_" '
  .users  |= map(select(.id != $u)) |
  .creds  |= map(select(.userId != $u)) |
  .subs   |= map(select(.userId != $u))' data/db.json > data/db.json.new \
  && jq empty data/db.json.new && mv data/db.json.new data/db.json
rm -f "data/state-$UID_.json"
docker compose start api
```

### Recover a user who lost their passkey

There is **no supported path**: a profile has exactly one credential and no recovery flow. Options:

1. The user registers a **new profile** and imports their JSON backup (**Settings → Data → Import backup**) — the
   preferred route.
2. Admin-assisted data transplant: have the user create the new profile (note the new uid from `db.json`), stop the
   API, then copy `state-<olduid>.json` to `state-<newuid>.json`, and delete the old user/creds. The new passkey now
   opens the old data.

### Reset a stuck invite

Revoking via the API is only possible for unused codes. To remove a used one, edit `db.json` with the API stopped.

### Editing a profile by hand

Useful for fixes the UI does not offer — for example **nutrition targets**, which the app only lets a user set
once. Two safe routes:

**A. Through a backup (no server access needed)**
1. In the app: **Settings → Data → Export backup (JSON)**.
2. Edit the file (for example set `nutrition.targets.kcal`, `.protein`, `.carbs`, `.fat`).
3. **Settings → Data → Import backup.** This **replaces** the whole state on that device and syncs it to the
   server.

**B. Directly on the server**
1. Stop nothing — `state-<uid>.json` is read on demand — but ask the user to **close the app on all devices**, because
   an open client will push its own (older) copy over your change.
2. Edit the file, bump `_ts` to `Date.now()` so clients prefer the server copy on their next pull
   (`date +%s%3N` on GNU `date`), and validate with `jq empty`.

## Migrations

There is no migration framework. Compatibility rules the code follows, which you should preserve when changing the
state shape:

1. **Additive only.** New keys must have a default in `DEF` and tolerate being absent in stored data.
2. **Absent means "as before".** New behavioural flags (`bodyweight`, `side`, `mode`, `effort`) are read so that a
   missing value reproduces the old behaviour — see comments in `frontend/src/lib/history.js`.
3. **Overlay on load.** State is loaded as `Object.assign(clone(DEF), stored)` — a **shallow** merge. A newly added
   *sub-key* inside an existing object key (for example `nutrition.mealPlan`) is **not** back-filled; code must guard
   (`log = {}` defaults in `lib/nutrition.js`).
4. **Never rewrite history.** Finished workouts are a log; derived values (next target, 1RM) are recomputed from them.

A destructive state change needs a one-off script over `state-*.json` run with the API stopped, plus a backup.

## Capacity and performance notes

- **Memory:** `db.json` is fully resident; size is dominated by `subs` and `creds` (~1 KB per user). Negligible.
- **I/O:** every `db.json` write rewrites the full file. The 10 s reminder loop reads the state file of each user
  with a push subscription **and** a reminder enabled (cheap per user, linear in their number). The admin
  `GET /api/admin/users` reads **every** state file.
- **Practical ceiling:** hundreds of users on a small VM. If you need more, you need a real database — which means
  changing `api/server.js`, not tuning it.
