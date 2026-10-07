# Deployment

For a gentle walkthrough aimed at hobbyists see [`SELF_HOSTING.md`](../SELF_HOSTING.md). This page is the
reference for administrators.

## Requirements

- A Linux host (amd64 or arm64; images are multi-arch) with a current **Docker Engine** and the **Compose v2 plugin**.
- ~300 MB disk for images and media, plus user data (small: a heavy user's state is typically well under 1 MB).
- Outbound HTTPS to `github.com` on first start (media download) and to Web Push services if notifications are used.
- A **DNS name** and a **TLS terminator** for anything beyond `localhost` — passkeys do not work over plain HTTP
  except on `http://localhost`.

## Standard deployment (Docker Compose)

```bash
git clone https://github.com/DuarteSantos8/openGym
cd Gymme
cp .env.example .env            # edit RP_ID / ORIGIN, see configuration.md
docker compose pull              # prebuilt images
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/api/health   # {"ok":true,"users":0}
```

The first start runs the one-shot `media` container, which clones the exercise dataset (~140 MB). Subsequent starts
skip it because `./media/img` is non-empty.

### Hardened Compose override

Keep the upstream file pristine and add `docker-compose.override.yml` (loaded automatically). This is a **template
that has not been run against every release**: apply it, then confirm `docker compose ps` shows both services
healthy/running and that sign-in, a workout sync and a push notification still work before relying on it.

```yaml
services:
  api:
    image: ghcr.io/duartesantos8/opengym-api:1.5.0   # pin
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 256m
    pids_limit: 128
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
  web:
    image: ghcr.io/duartesantos8/opengym-web:1.5.0   # pin
    ports: !override
      - "127.0.0.1:8080:80"        # only the reverse proxy on the host can reach it
    read_only: true
    tmpfs: [/var/cache/nginx, /var/run, /tmp]
    cap_drop: [ALL]
    cap_add: [CHOWN, SETGID, SETUID, NET_BIND_SERVICE]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 128m
```

Notes:

- `!override` requires a recent Compose v2 (≥ 2.24). On older versions edit the `ports:` entry in the main file.
- The API image is Alpine with `wget` (BusyBox), so the `wget` healthcheck works without extra packages.
- `read_only: true` on `api` is safe: it only writes to `/data` (a bind mount) and, transiently, `*.tmp` files next to
  the target file inside `/data`.
- The API runs as **root** by default. To run it unprivileged, set `user: "1000:1000"` and `chown -R 1000:1000 ./data`
  first. Test a restart: `secret` and `vapid.json` must remain readable (mode `0600`, owner must match).
- `nginx` needs the dropped capabilities re-added as above to start workers; verify with `docker compose logs web`.

## Reverse proxy and TLS

Gymme does **not** terminate TLS. Put a reverse proxy in front of `web` (`127.0.0.1:8080`) that:

1. terminates **HTTPS** for exactly the hostname in `ORIGIN`/`RP_ID`;
2. forwards to the `web` container (it proxies `/api/` itself — do not split routes at the front proxy);
3. adds **rate limiting** and **security headers**, which neither the app nor the shipped nginx config provide;
4. raises the **request-size** limit (see below);
5. needs no WebSocket or streaming support — the app uses plain HTTP/1.1 request/response only.

### Caddy

```caddy
gym.example.com {
    encode zstd gzip
    request_body {
        max_size 6MB
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        X-Frame-Options "DENY"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }
    reverse_proxy 127.0.0.1:8080
}
```

### nginx (host-level)

```nginx
limit_req_zone $binary_remote_addr zone=gymme_auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=gymme_api:10m  rate=10r/s;

server {
    listen 443 ssl http2;
    server_name gym.example.com;
    ssl_certificate     /etc/letsencrypt/live/gym.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gym.example.com/privkey.pem;

    client_max_body_size 6m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header Referrer-Policy           "no-referrer" always;
    add_header X-Frame-Options           "DENY" always;

    # Throttle the endpoints that answer without a session and the invite oracle.
    location ~ ^/api/(register|login)/ {
        limit_req zone=gymme_auth burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /api/ {
        limit_req zone=gymme_api burst=40 nodelay;
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
server { listen 80; server_name gym.example.com; return 301 https://$host$request_uri; }
```

A Content-Security-Policy is **not** included because the app uses inline styles and a service worker; if you add one,
test the full workout flow and push notifications before rolling it out.

### Cloudflare Tunnel / Traefik / Nginx Proxy Manager

Any proxy works if it serves `https://<RP_ID>` and forwards to `web:80`. With Cloudflare Tunnel point the
public hostname at `http://<docker-host>:8080`; add WAF/rate-limit rules in Cloudflare for `/api/register/*` and
`/api/login/*`.

### Request size

`api/server.js` accepts bodies up to **5 MB**, but the shipped `web/nginx.conf` does not set
`client_max_body_size`, so nginx's default of **1 MB** applies between the front proxy and the API. If a profile's
JSON state exceeds 1 MB, `PUT /api/data` fails with **413 Request Entity Too Large**, the client marks itself
dirty and sync silently stops for that user.

Fix by adding to `web/nginx.conf` (inside `server { … }` or at `http` level) and rebuilding the web image:

```nginx
client_max_body_size 6m;
```

Set the front proxy limit slightly above the API's 5 MB (6 MB above) so the application's own limit is what users hit.
Check state sizes: `ls -lS data/state-*.json | head`.

## Updating

```bash
cd Gymme
git pull                                  # compose / config changes
docker compose pull                       # new images
docker compose up -d                      # recreates only changed services
docker compose logs --tail=50 api web
curl -fsS http://127.0.0.1:8080/api/health
```

Downtime is a few seconds while containers are recreated. In-memory data (challenges, presence, scheduled
rest-timer pushes) is dropped; stored data is untouched. Clients pick up new frontend code on next load
(`index.html` is served with `no-cache`).

**Before upgrading across a minor/major version**, read `CHANGELOG.md` and take a [backup](operations.md#backup-and-restore).

## Rollback

Images are immutable and tagged, so rollback is a tag change:

```bash
# docker-compose.override.yml (or docker-compose.yml)
#   image: ghcr.io/duartesantos8/opengym-api:1.4.2
#   image: ghcr.io/duartesantos8/opengym-web:1.4.2
docker compose up -d
```

Use `:sha-<short>` to roll back to an exact commit. Data files are forward-compatible by construction (clients
overlay stored state onto defaults, and the API tolerates missing fields), but a rollback after a release that
**added** data fields leaves those fields in the files; older code ignores them. Restore a backup only if a release
corrupted data.

## Other targets

- **`render.yaml`** deploys only the static web tier (`web/Dockerfile`). nginx proxies `/api` to a host named
  `api`, so Render needs a second service of that name for the API **and a persistent disk** for `/data`. As
  committed, the file is incomplete for a working instance.
- **Kubernetes:** run **one replica** of `api` with a `ReadWriteOnce` volume and `strategy: Recreate`. Do not use
  more than one replica (see [hard limits](architecture.md#hard-limits)). Use an Ingress for TLS and rate limiting.
- **Bare metal (no Docker):** run `node api/server.js` with `DATA_DIR`, `RP_ID`, `ORIGIN` set (Node ≥ 20; the
  image uses 22), and serve `frontend/dist` with a web server that proxies `/api/` to the API and `/img`, `/gif` to
  the media directories. Keep one origin.

## Network and firewall summary

| Flow | Direction | Required |
|---|---|---|
| Client → reverse proxy | in, 443/tcp | Yes |
| Reverse proxy → `web` | local, 8080/tcp | Yes |
| `web` → `api` | Compose network, 3000/tcp | Yes |
| API → push services (FCM, Mozilla autopush, Apple) | out, 443/tcp | Only if notifications are used |
| `media` → `github.com` | out, 443/tcp | First start only |
| Client → `cdn.jsdelivr.net` | out | Mobile app only (exercise media) |
