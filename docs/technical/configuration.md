# Configuration

Gymme is configured with environment variables, loaded from `.env` next to `docker-compose.yml`
(`env_file: .env` on the `api` service; `WEB_PORT` is also read by Compose itself for variable substitution).
`.env` is git-ignored; `.env.example` is the template.

## Environment variables

### Required for a non-localhost deployment

| Variable | Default | Used by | Description |
|---|---|---|---|
| `RP_ID` | `localhost` | api | WebAuthn **Relying Party ID**: the bare hostname passkeys are bound to (`gym.example.com`, no scheme, no port). **Changing it invalidates every existing passkey.** Must be equal to, or a registrable suffix of, the host in `ORIGIN`. |
| `ORIGIN` | `http://localhost:8080` | api | Exact origin the browser uses, including scheme and port if non-default (`https://gym.example.com`). Checked as `expectedOrigin` on every WebAuthn verification. If it starts with `https:`, the session cookie gets the `Secure` flag. |

### Optional

| Variable | Default | Description |
|---|---|---|
| `WEB_PORT` | `8080` | Host port published for the `web` container (`${WEB_PORT:-8080}:80`). |
| `RP_NAME` | `Gymme` | Display name shown in the passkey prompt. |
| `ADMIN_UIDS` | *(empty)* | Comma-separated user ids that get the admin dashboard and `/api/admin/*`. Ids are in `data/db.json` → `users[].id`. A user can also be an admin via `"admin": true` in `db.json`. Empty means **no admin**. |
| `INVITE_ONLY` | *(off)* | `1`, `true`, `yes` or `on` (case-insensitive) requires a valid invite code to register. Existing accounts are unaffected. |
| `SESSION_DAYS` | `90` | Lifetime of **newly issued** session cookies, in days (minimum 1). Existing cookies keep the lifetime they were issued with. |
| `VAPID_SUBJECT` | `ORIGIN` if HTTPS, else `mailto:admin@localhost` | The `sub` claim for Web Push. Push services may require a real `mailto:` or `https:` URL; set `VAPID_SUBJECT=mailto:you@example.com` if a push provider rejects the default. |

### Set by Compose (do not change)

| Variable | Value | Description |
|---|---|---|
| `PORT` | `3000` | API listen port. nginx proxies to `api:3000`. Changing it requires editing `web/nginx.conf`. |
| `DATA_DIR` | `/data` | Data directory inside the API container (mounted from `./data`). |

> **Secrets in `.env`:** there are none by design. The session HMAC key and VAPID keys are **generated and stored
> in `./data`**, not in the environment. Treat `./data` as the secret.

### Example `.env` for production

```bash
RP_ID=gym.example.com
ORIGIN=https://gym.example.com
WEB_PORT=8080              # bind behind your reverse proxy; see deployment.md
RP_NAME=Gymme
INVITE_ONLY=1
ADMIN_UIDS=piYdx5GveQarq8u9
SESSION_DAYS=30
VAPID_SUBJECT=mailto:ops@example.com
```

### Validation rules and gotchas

- `RP_ID` and `ORIGIN` must agree. The classic failure is `verification failed: …` at login — the page URL differs
  from `ORIGIN` (scheme, host or port) or `RP_ID` is not the page's host.
- `ORIGIN` is **not** derived from request headers. A reverse proxy that terminates TLS does not need to forward
  `X-Forwarded-Proto`; the API just trusts `ORIGIN`.
- Compose `env_file` passes the whole `.env` into the API container, including `WEB_PORT` (harmless).
- There is **no** variable for the host data path in Compose; change the bind mount instead.

## Ports

| Port | Where | Exposure |
|---|---|---|
| `80` | `web` container | Published as `${WEB_PORT:-8080}` on **all host interfaces** by default. |
| `3000` | `api` container | Not published. Reachable only on the Compose network from `web`. |

To restrict the published port to loopback (recommended behind a host-level reverse proxy), edit
`docker-compose.yml`:

```yaml
    ports:
      - "127.0.0.1:${WEB_PORT:-8080}:80"
```

## Volumes

| Host path | Container | Mode | Contents |
|---|---|---|---|
| `./data` | `api:/data` | rw | All persistent state. **Back this up.** See [data-model](data-model.md). |
| `./media/img` | `web:/usr/share/nginx/html/img`, `media:/out/img` | ro in `web` | Exercise images (JPG). ~140 MB total with GIFs. |
| `./media/gif` | `web:/usr/share/nginx/html/gif`, `media:/out/gif` | ro in `web` | Exercise animations (GIF). |

Files in `./data` are created by the API process, which runs as **root** inside the container (the image sets no
`USER`). On the host they are owned by root. See [Security](security.md#container-hardening).

## Image tags

The Compose file references `latest`:

```yaml
image: ghcr.io/duartesantos8/opengym-api:latest
image: ghcr.io/duartesantos8/opengym-web:latest
```

Every merge to `main` publishes `:latest` and `:sha-<short>`; every release adds `:X.Y.Z` and `:X.Y`. **Pin a tag in
production** so an update is a deliberate act and rollback is a one-line change:

```yaml
image: ghcr.io/duartesantos8/opengym-api:1.5.0
image: ghcr.io/duartesantos8/opengym-web:1.5.0
```

Build from source instead by omitting `docker compose pull` and running `docker compose up -d --build`
(each service has a `build:` section).

## Frontend build-time variables

Read by Vite, not at runtime. Relevant only when building the web, demo or mobile bundle yourself.

| Variable | Effect |
|---|---|
| `VITE_DEMO=1` | Demo build: guest-only, seeded example data, no backend. |
| `VITE_MOBILE=1` | Mobile build for Capacitor. |
| `VITE_IMG_BASE`, `VITE_GIF_BASE` | Base URLs for exercise media (the mobile script pins jsDelivr to a dataset commit). |
| `API_TARGET` | Dev server only: where `vite` proxies `/api` (default `http://127.0.0.1:3000`). |
| `MEDIA_TARGET` | Dev server only: where it proxies `/img` and `/gif` (default `http://127.0.0.1:8888`). |
