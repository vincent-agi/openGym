# Development guide

For contribution rules (scope, style, commit format, PR process) read [`CONTRIBUTING.md`](../../CONTRIBUTING.md) first.
This page is about **how the code is organised and how to work in it**.

## Repository layout

```
api/                 backend: server.js (single file), Dockerfile, package.json
frontend/            React + Vite app
  src/
    App.jsx          router + shell (HashRouter), applies theme/accent/language, mounts global UI
    main.jsx         entry
    sheets.jsx       ~1200 lines: every bottom sheet / modal flow (weigh-in, exercise config, plan share, import, …)
    views/           one file per screen: Home, Plan, RoutineEdit, Workout, Stats, History, Nutrition,
                     Library, Settings, Login, Admin
    components/      shared UI: ui.jsx (Row, Section, Switch, Button…), charts, BodyMap, Heatmap, RestTimer, Toast…
    store/           useStore.js (user state S + sync), useUI.js (sheets, toasts, timers)
    lib/             pure logic + tests (see below)
    locales/         UI translations (11 languages; English strings are the keys)
    instr/           generated exercise-instruction packs (9 languages)
  public/            service worker, manifest, icons
  android/ ios/      Capacitor native shells
  scripts/           check-locales.mjs
web/                 Dockerfile (build SPA → nginx) + nginx.conf
website/             static project website (no build step)
docs/                documentation (user/, technical/, plus legacy guides)
scripts/             build-instructions.mjs, fetch-media.sh
media/               exercise images/GIFs (git-ignored, fetched at runtime)
data/                runtime data (see data-model.md — must not be committed)
```

The root `nginx.conf` is an identical copy of `web/nginx.conf`; the Docker build uses the one in `web/`.

## Local setup

### Everything in Docker (closest to production)

```bash
cp .env.example .env
docker compose up -d --build         # api + web + media on http://localhost:8080
```

### Frontend with hot reload

```bash
docker compose up -d api media web    # backend + media on :8080
cd frontend
npm install
API_TARGET=http://localhost:8080 MEDIA_TARGET=http://localhost:8080 npm run dev
```

The Vite dev server proxies `/api`, `/img` and `/gif` (defaults `127.0.0.1:3000` and `127.0.0.1:8888`). If you run the
API directly instead of through Docker:

```bash
cd api && npm ci
DATA_DIR=$(mktemp -d) RP_ID=localhost ORIGIN=http://localhost:5173 node server.js
```

Set `ORIGIN` to the **dev server's** origin (Vite defaults to `http://localhost:5173`) or WebAuthn verification fails.
`http://localhost` is the one non-HTTPS origin browsers accept for passkeys.

### Tests

```bash
cd frontend
npm test                # vitest run (CI)
npm run test:watch
node scripts/check-locales.mjs    # locale key parity (not in CI)
```

### API tests

```bash
cd api
npm ci
npm test                # node --test test/  (Node built-ins only, no extra dependency)
```

Tests live in `api/test/*.test.js` and run each file in its own process. `test/helpers.js` exposes
`startTestServer()`: it boots the real `server.js` on an ephemeral port with a throw-away `DATA_DIR`, and
`createUser()` writes a user straight into the identity store and returns a session cookie signed by the production
code (no WebAuthn ceremony). Use `request(path, { method, body, as })` to call routes as a given user.

`server.js` only listens when it is the entry point (`node server.js`); importing it, as the tests do, does not.
CI runs `npm test` in the `API (syntax + boot smoke)` job, followed by the boot smoke test.

## Frontend architecture

### State

`useStore` (Zustand) holds:

| Field | Purpose |
|---|---|
| `S` | The user's whole state document (shape in [data-model](data-model.md#state-uidjson-schema)). |
| `user` | `{id,name,admin}` when signed in, else `null`. Mirrored in `localStorage` (`gym_user`). |
| `ready` | Boot finished (session checked). |
| `update(mutator, push=true)` | The only way to change `S`: clone → `mutator(draft)` → `persist`. |
| `replaceState(S, push)` | Replace everything (import, reset). |
| `pullState / pushState` | Sync with `GET/PUT /api/data`. |
| `signOut / signOutAll` | Clear session (the second calls `POST /api/logout/all`). |
| `boot()` | Mobile → restore from file mirror; demo → seed once; web → `GET /api/me` then pull. |

`persist` stamps `S._ts`, registers custom exercises, writes `localStorage` (`gym_state_v1`), updates the store, and (when
signed in) debounces `pushState` by 1.5 s. A `visibilitychange → hidden` handler flushes pending pushes immediately.
Other `localStorage` keys: `gym_guest`, `gym_dirty`, `gym_demo_seeded_v1`.

Rules of thumb:

- **Never mutate `S` directly.** Always `update(s => { … })`.
- **Add a default for every new top-level key in `DEF`.** Loading is a *shallow* `Object.assign(clone(DEF), stored)`,
  so nested sub-keys added later are **not** back-filled — guard reads (`obj?.x ?? {}`) as `lib/nutrition.js` does.
- **Absent must mean "behave as before"** for any new flag (see `history.js` comments on `mode`, `bodyweight`, `side`).

### `src/lib/` — pure logic

Keep decision logic here, not in components, and give it a `*.test.js` beside it.

Friends module: `lib/social.js` (sharing settings rules), `lib/friends.js` (codes and links), `lib/crew.js` (leaderboard ranking: ties share a position, ordered only by name; people without a number are shown neutrally and never last; Consistency is a weekly metric only).

| Module | Responsibility |
|---|---|
| `history.js` | Reading a logged session: modes (`reps`/`time`/`cardio`), bodyweight and per-side flags, set labels, effective routine for a date, PRs, streaks, volume, superset units. |
| `progression.js` | Next-session prescription from history. Policies: `off`, `linear`, `greyskull`, `double`, `time`. Deload rules, increments, bodyweight rep/set growth. |
| `onerm.js` | Estimated 1RM (Epley, Brzycki, Lombardi), rep cap 12, per-workout series. |
| `effort.js` | RIR/RPE aggregation and statistics (internally RIR). |
| `muscles.js`, `body-paths.js` | Muscle aliasing and the body-map geometry. |
| `exercises.js`, `exercises-data.js` | Catalogue, equipment/body-part filters, mobility compatibility, custom exercises. |
| `nutrition.js`, `measurements.js`, `goals.js` | Targets, log reducers, measurement series, goal progress. |
| `import-csv.js` | FitNotes / Strong / Hevy CSV and Apple Health XML importers (header-driven column mapping). |
| `plan-share.js` | Plan export/import bundle (format version `PLAN_FMT = 1`) and printable page. |
| `api.js` | `fetch` wrapper and WebAuthn helpers. |
| `i18n.js` | `t()`, language packs, instruction packs. |
| `mobile.js`, `push.js`, `wakelock.js`, `sound.js` | Platform integrations. |
| `demo.js`, `demoSeed.js` | Demo build flag and seeded example data. |

Why this matters: `store/useStore.js` and `sheets.jsx` touch `document` at import time, so they **cannot be unit
tested without a DOM**. Anything that needs a test must live in a pure module (this is the stated reason `nutrition.js`
holds the log reducers instead of `sheets.jsx`).

### Progression engine in brief

`nextPrescription(S, cfg, routine)` derives the target from history on every call; nothing is stored, so editing or
deleting a past workout changes the next target immediately. A session is read by `readSession(entry, fallback)`:
a set counts as a **hit** only if ticked **and** meeting the target; anything else is a **miss**. Older workouts without
a stored `target` are judged against the exercise's current plan to avoid spurious deloads. Add a policy by:
extending `POLICIES`, `POLICIES_FOR`, `POLICY_NAME`/`POLICY_DESC`, `DELOAD_AFTER`, implementing the branch in
`nextPrescription`, adding the translations, and covering it in `progression.test.js`.

### Internationalisation

- Strings are wrapped in `t('English text', …args)`; `{0}`, `{1}` are positional.
- English has no file. Add the key to **every** file in `src/locales/` (there are 11) — a key missing from some locales
  silently falls back to English. Run `node frontend/scripts/check-locales.mjs` to catch mismatches.
- To add a language: create `src/locales/<code>.js`, add it to `LANGS` (and `DATE_LOCALES`) in `lib/i18n.js`, and — if the
  upstream dataset has instructions for it — add it to `INSTR_LANGS` and `LANGS` in `scripts/build-instructions.mjs`, then run
  `node scripts/build-instructions.mjs` to generate `src/instr/<code>.js`.
- Admin screens are intentionally English-only.

### UI conventions

- Screens are in `views/`; flows that are modal go in `sheets.jsx` and are opened through `useUI.openSheet(close => <… />)`.
- Reuse `components/ui.jsx` primitives (`Section`, `Row`, `SelectRow`, `Switch`, `Segmented`, `Button`, `TextField`,
  `NumberField`) so spacing and states stay consistent.
- Colours come from CSS variables; the accent (`data-accent`), theme (`data-theme`) and touch size (`data-touch`) are
  set on `<html>` by `App.jsx`.
- Icons are an in-repo set (`components/Icon.jsx`); do not add emoji or an icon library.

### Service worker and PWA

`public/sw.js` is registered by `main.jsx` **only over `https:`** (and never in the mobile build), so on plain
`http://localhost` there is no service worker, no offline fallback and no push. Test those paths behind TLS. Behaviour: cache-first for `/img/` and `/gif/`, network-first with a cached fallback for
the rest, never `/api/`. It also handles `push` (shows a notification) and `notificationclick` (focuses or opens the
app). `manifest.json` makes the app installable (standalone, portrait).

## Backend development

See [API reference](api-reference.md#writing-a-new-endpoint). Principles that keep the file small and safe:

- Derive identity from the session, **never from the request body**, when reading or writing user data.
- Persist state with `atomicWrite`; mutate `db` then call `saveDb()` for identity data.
- Keep new timers `unref()`'d so they do not block shutdown.
- Do not add dependencies lightly (`api/` has two; `frontend/` ships React, the router and Zustand only).
- Anything reachable **without a session** must be documented in `SECURITY.md` and in the [API reference](api-reference.md).

## Mobile app (Capacitor)

The mobile flavour is the same bundle built with `VITE_MOBILE=1` and wrapped by Capacitor (`appId`
`app.viny.gymme`, `webDir: dist`). Full instructions are in [`docs/MOBILE.md`](../MOBILE.md); the essentials:

```bash
cd frontend
npm install
npm run build:mobile            # VITE_MOBILE build with pinned jsDelivr media bases + `cap sync`
npx cap open android            # Android Studio (Java 21)
npx cap open ios                # Xcode 15+ (Mac, CocoaPods)
```

- State is mirrored to `gymme-state.json` in the app's private directory on every change (iOS may evict WebView
  storage); backups use the OS share sheet.
- Reminders are native local notifications scheduled from the weekly plan (`lib/mobile.js` → `syncReminder`).
- After `build:mobile`, `frontend/dist` holds the **mobile** bundle. Run a plain `npm run build` again before deploying
  `dist` to a web server.
- Release signing: create and **keep** a keystore; Android refuses updates signed with a different key.
- Bump `versionName`/`versionCode` in `android/app/build.gradle` manually (not covered by release-please).

## Exercise data

- Source: `hasaneyldrm/exercises-dataset`. Images/GIFs are fetched at runtime into `./media` (not committed).
- Catalogue and English instructions are inline in `lib/exercises-data.js` (one ~900 KB chunk, see `vite.config.js`).
- Other-language instructions are generated: `node scripts/build-instructions.mjs [path-to-exercises.json]` (downloads
  upstream if no path is given) and committed under `src/instr/`. Do not edit those files by hand.
- Dataset licence terms are in [`NOTICE.md`](../../NOTICE.md); body-map geometry is MIT-licensed from MuscleMap.

## Debugging tips

| Problem | Where to look |
|---|---|
| Passkey ceremony fails locally | API start-up log line (`rpID`, `origin`); `ORIGIN` must equal the **browser** origin including port. |
| State not syncing | DevTools → Application → Local Storage: `gym_dirty=1` means pushes are failing; check the Network tab for `PUT /api/data` (413 = body limit). |
| Stale UI after a deploy | The service worker is network-first; hard-reload once. `index.html` is `no-cache`. |
| A test needs `document` and fails | The code under test imports `useStore`/`sheets.jsx`; move the logic into a pure `lib/` module. |
| Locale string shows English | Key missing in that locale file; run `check-locales.mjs`. |
| Different behaviour on demo | `VITE_DEMO` folds out sign-in and seeds data; test the self-hosted flavour separately. |

## Pull request checklist

- Conventional Commit title (`feat(scope): …`) — it drives the version and changelog.
- Tests for any training logic; `npm test` and `npm run build` pass.
- New strings added to all 11 locales; `check-locales.mjs` clean.
- Clicked through the affected screens and the workout flow in a browser.
- No `data/` or `media/` committed; no secrets.
- Docs updated (these pages, `SECURITY.md` if the attack surface changed). Do **not** edit `CHANGELOG.md`; it is generated.
