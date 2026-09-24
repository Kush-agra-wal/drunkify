# Drunkify

Mobile-first, offline-capable PWA for logging drinks on trips with friends. One Node process, one SQLite file, zero npm dependencies.

## Requirements

- Node.js >= 22.13 (uses the built-in `node:sqlite` without a flag). Node 24 is what the Docker image uses.

## Run locally

```sh
npm start          # http://localhost:8080
npm test           # node:test API tests (boots throwaway servers with temp data dirs)
```

There is nothing to install: no `node_modules`, no build step. The frontend in `public/` is served as-is.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` | SQLite file `trip-drinks.db` lives here |
| `REGISTRATION_CODE` | _(unset)_ | If set, sign-up requires this code |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `TRUST_PROXY` | `0` | Number of trusted reverse-proxy hops in front of the app. `0` ignores `X-Forwarded-For` |
| `PUBLIC_DIR` | `./public` | Static files directory (mainly for tests) |

## Deploy on a homelab

```sh
docker compose up -d --build
```

`docker-compose.yml` builds the image, keeps data in the named volume `drunkify-data`, and restarts unless stopped. The container runs as the non-root `node` user and has a `/healthz` healthcheck.

### HTTPS / reverse proxy

Service workers (offline mode, installability) only work on `https://` or `localhost`. Put the app behind a TLS-terminating proxy and set `COOKIE_SECURE=true`:

- **Caddy**: `drinks.example.com { reverse_proxy drunkify:8080 }`
- **Tailscale**: `tailscale serve --bg 8080` gives you an HTTPS `*.ts.net` URL inside your tailnet.

Rate limits (login, register, password change) key on the client IP. By default `X-Forwarded-For` is ignored and the socket address is used. Behind one proxy (Caddy, nginx, `tailscale serve`) set `TRUST_PROXY=1`; the app then uses the rightmost untrusted hop, so a client cannot spoof its IP by sending its own header. This deliberately differs from the SPEC's "first hop" wording, which is spoofable.

## Backup

Everything lives in `DATA_DIR/trip-drinks.db` (WAL mode). Either stop the container and copy the file, or take a live, consistent snapshot:

```sh
docker compose exec drunkify sh -c 'cd /data && node -e "new (require(\"node:sqlite\").DatabaseSync)(\"trip-drinks.db\").exec(\"VACUUM INTO \x27backup.db\x27\")"'
# or, with the sqlite3 CLI on the host volume:
sqlite3 /path/to/trip-drinks.db ".backup backup.db"
```

## API overview

JSON API under `/api/`, cookie session (`sid`), and every mutating request must send `X-Requested-With: trip-drinks`. Sync is offline-first: clients push entries with client-generated ids and `updated_at`; the server applies last-write-wins per entry and returns changes per trip via `trip_cursors`. See `SPEC.md` for the full contract.
