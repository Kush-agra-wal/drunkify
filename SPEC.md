# Drunkify — build spec (source of truth for all builders)

Mobile-first, offline-capable PWA to log drinks during trips with friends. Self-hosted on a homelab via Docker.

## Hard constraints
- **Zero npm dependencies.** Node >= 22 built-ins only: `node:http`, `node:sqlite` (`DatabaseSync`), `node:crypto`, `node:fs`, `node:path`, `node:test`. No `package-lock`, no `node_modules`. `package.json` exists only for scripts (`start`, `test`) and `"type": "module"`.
- **No frontend build step.** Vanilla ES modules, one CSS file, hand-written service worker. No frameworks, no CDN assets (must work fully offline after first load). Target total frontend payload < 150 KB uncompressed.
- All imports at module scope. Sparse comments.
- Server serves the static frontend from `public/` and the JSON API under `/api/`.
- Config via env: `PORT` (default 8080), `DATA_DIR` (default `./data`, sqlite file `trip-drinks.db` inside), `REGISTRATION_CODE` (optional; if set, register requires it), `COOKIE_SECURE` (default `false`; `true` when behind HTTPS).
- Do NOT run Docker locally. Tests run with plain `node --test`.

## Layout
```
trip-drinks/
  package.json            # {"type":"module","scripts":{"start":"node --disable-warning=ExperimentalWarning server/index.js","test":"node --disable-warning=ExperimentalWarning --test test/"}}
  server/index.js         # http server, routing, static files (with correct MIME, gzip if Accept-Encoding allows, Cache-Control: no-cache for index.html/sw.js, long cache otherwise is NOT needed — keep simple: no-cache everywhere + ETag)
  server/db.js            # schema + migrations (PRAGMA user_version), WAL mode
  server/auth.js          # scrypt password hashing, sessions
  server/validate.js      # input validation helpers
  public/index.html
  public/styles.css
  public/app.js           # entry (ES module); may split into public/js/*.js
  public/catalog.js       # drink catalog (categories, popular brands/cocktails, default volumes & ABV)
  public/sw.js
  public/manifest.webmanifest
  public/icon.svg          # plus maskable icon (svg ok); also icon-192.png/icon-512.png may be omitted — svg icons acceptable
  test/*.test.js          # node:test API tests that boot the server on a random port with a temp DATA_DIR
  Dockerfile
  docker-compose.yml
  .dockerignore
  README.md
```

## Data model (SQLite)
- `users(id TEXT PK uuid, username TEXT UNIQUE COLLATE NOCASE, display_name TEXT, password_hash TEXT, created_at INTEGER)`
- `sessions(token_hash TEXT PK, user_id, created_at, expires_at)` — token = 32 random bytes base64url, stored as sha256 hash. 90-day expiry, sliding.
- `trips(id TEXT PK uuid, name, owner_id, invite_code TEXT UNIQUE, archived INTEGER 0/1, created_at, updated_at)` — invite_code: 8 chars from unambiguous alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- `trip_members(trip_id, user_id, joined_at, PK(trip_id,user_id))`
- `entries(id TEXT PK uuid (client-generated), trip_id, user_id, category, name, volume_ml REAL NULL, abv REAL NULL, quantity REAL, consumed_at TEXT ISO-8601, note TEXT, updated_at INTEGER (client ms), deleted INTEGER, server_seq INTEGER)` — `server_seq` is a global monotonically increasing counter (from a `meta` table or `MAX(server_seq)+1` inside the write transaction) set on every insert/update; index on `(trip_id, server_seq)`.
- Migrations are append-only (`PRAGMA user_version`); never edit one that has shipped, add a new one.

## Auth
- Cookie `sid` (HttpOnly, SameSite=Lax, Path=/, Max-Age 90d, Secure iff COOKIE_SECURE=true).
- Passwords: `crypto.scrypt` with random 16-byte salt, stored `scrypt$N$r$p$salt$hash` (base64url). Constant-time compare.
- Username: 3–32 chars `[a-zA-Z0-9_.-]`. Password min 6 chars. display_name 1–40 chars.
- Basic in-memory rate limit on login/register: 10 attempts / 5 min per IP (use `X-Forwarded-For` first hop if present, else socket address).
- CSRF: all mutating API requests must send header `X-Requested-With: trip-drinks` (reject otherwise with 403). Frontend always sends it.
- Request body limit 256 KB; JSON only.

## API (all JSON; errors: `{"error": "human message"}` with proper 4xx/5xx)
User object: `{id, username, display_name}`
Trip object: `{id, name, owner_id, invite_code, archived (bool), created_at, updated_at, members: [{id, display_name, username}]}`
Entry object: `{id, trip_id, user_id, category, name, volume_ml, abv, quantity, consumed_at, note, updated_at, deleted (bool), server_seq}`

| Method | Path | Body | Response |
|---|---|---|---|
| GET | /healthz | – | `ok` text 200 |
| GET | /api/config | – | `{registration_code_required: bool}` (no auth) |
| POST | /api/auth/register | `{username, password, display_name, registration_code?}` | 201 `{user}` + sets cookie |
| POST | /api/auth/login | `{username, password}` | `{user}` + sets cookie |
| POST | /api/auth/logout | – | `{ok:true}` clears cookie + deletes session |
| GET | /api/me | – | `{user}` (401 if not logged in) |
| PATCH | /api/me | `{display_name?}` | `{user}` |
| POST | /api/me/password | `{current_password, new_password}` | `{ok:true}` |
| GET | /api/trips | – | `{trips:[trip]}` (member trips, newest first) |
| POST | /api/trips | `{id?, name}` (id optional client uuid for idempotency) | 201 `{trip}` creator becomes owner+member |
| GET | /api/trips/:id | – | `{trip}` (member only, else 404) |
| PATCH | /api/trips/:id | `{name?, archived?}` | `{trip}` owner only (403) |
| DELETE | /api/trips/:id | – | `{ok:true}` owner only; deletes trip, members, entries |
| POST | /api/trips/:id/invite/rotate | – | `{trip}` owner only |
| GET | /api/invite/:code | – | `{trip:{id,name,member_count}}` preview (auth required) |
| POST | /api/trips/join | `{invite_code}` (case-insensitive) | `{trip}` (idempotent if already member) |
| POST | /api/trips/:id/leave | – | `{ok:true}`; owner cannot leave unless they are the last member (then trip deleted) — return 400 with message otherwise |
| DELETE | /api/trips/:id/members/:userId | – | owner removes member; `{trip}` |
| POST | /api/sync | `{cursor: int (0 initially), changes: [entry-without-server_seq]}` | `{cursor, entries:[entry], applied:[id], rejected:[{id, reason}], trips:[trip]}` |
| GET | /api/trips/:id/export.csv | – | CSV download of non-deleted entries with member display names |

### Sync semantics (critical — offline-first)
- Client generates entry `id` (crypto.randomUUID) and `updated_at` (Date.now()) locally, stores in IndexedDB, and enqueues it in an outbox. Edits/deletes just bump `updated_at` and re-enqueue the full entry (delete = `deleted:true` tombstone).
- Server, per change, in one transaction: validate; reject if user not a member of `trip_id` (`reason:"not_member"`); if an entry with that id exists and belongs to another user → reject `"forbidden"`; if existing `updated_at` >= incoming `updated_at` → treat as applied but no-op (idempotent retry; last-write-wins); else upsert with new `server_seq`. `user_id` is always forced to the session user (never trusted from client). Trip id of an existing entry cannot change.
- Validation: category in the catalog category keys; name 1–60 chars; quantity number > 0 and <= 100; volume_ml null or 0 < v <= 5000; abv null or 0 <= v <= 100; consumed_at parseable ISO date; note <= 280 chars; updated_at integer; max 500 changes per request. Invalid → rejected with `reason` string, others still applied. Unknown keys are ignored (never stored or returned).
- Response `entries` = all entries (including tombstones) with `server_seq > cursor` in trips the user is currently a member of, ordered by server_seq, max 2000 per page; `cursor` = max server_seq returned (or input cursor if none). If more remain, include `more: true` and client loops. Also returns current `trips` list so membership/trip changes propagate.
- When a client is added to a new trip, it must receive that trip's full history: client handles this by tracking per-trip knowledge — simplest correct approach: server accepts optional `trip_cursors: {tripId: int}`; **use this instead of the single cursor**: request `{trip_cursors:{[tripId]: int}, changes}`, response `{trip_cursors:{...}, entries, applied, rejected, trips, more}`; for member trips missing from trip_cursors, cursor 0 is used. Entries for trips user is no longer in are not returned; client drops local data for trips not in `trips`.
- Categories (keys, must match catalog.js): `beer, wine, cocktail, spirit, shot, cider, seltzer, soft, other`. `soft` is non-alcoholic.

## Frontend (public/)
- Hash router: `#/login`, `#/trips`, `#/trip/:id` (log + feed), `#/trip/:id/stats`, `#/trip/:id/settings`, `#/join/:code`, `#/settings`.
- Local store: IndexedDB (`trip-drinks` db) stores: `entries`, `trips`, `outbox`, `kv` (me, trip_cursors, recents, favorites, custom_names). App works offline after the first successful login: all reads come from IndexedDB; writes go to IndexedDB + outbox; a sync loop pushes when `navigator.onLine`, on `online` event, on visibility change, every 30s while visible, and after each local write (debounced). Exponential backoff on failure. Visible sync status pill: "Synced", "Offline · N pending", "Syncing…", "Sync error".
- Service worker: precache app shell (all public files, versioned cache name); navigation → cache-first shell; `/api/*` never cached by SW (network only; app handles offline). Update flow: new SW waits; show "Update available — reload" toast.
- **Log drink flow (main screen, one-thumb):** big category grid (emoji + label). Tap category → bottom sheet with:
  - Type dropdown: popular options for that category from catalog (beers: Pilsner Urquell, Heineken, Budweiser, Stella Artois, Guinness, Corona, Carlsberg, Peroni, Asahi, Kingfisher, Hoegaarden, Paulaner, Erdinger, Staropramen, Kozel, Tuborg, Estrella Damm, Moretti, Beck's, Sapporo, Tiger, Chang, Leo, Singha, Bira 91, IPA (craft), Lager (house), Wheat beer (house), Stout (house), …; cocktails: Mojito, Margarita, Aperol Spritz, Negroni, Old Fashioned, Espresso Martini, Piña Colada, Cosmopolitan, Long Island Iced Tea, Daiquiri, Caipirinha, Moscow Mule, Whiskey Sour, Mai Tai, Gin & Tonic, Cuba Libre, Sex on the Beach, Tequila Sunrise, Pornstar Martini, Hugo Spritz, Bloody Mary, Dark 'n' Stormy, Paloma, Manhattan, Martini, Sangria…; wine: red/white/rosé/prosecco/champagne/etc; spirits: whisky, vodka, gin, rum, tequila, jägermeister, etc.; shots: tequila, jäger, sambuca, B-52, kamikaze…) **plus "Other…"** which reveals a free-text input. User-added custom names are remembered (recents) and appear at top of that category's dropdown next time.
  - Size: quick chips of common sizes per category (beer: 330 ml bottle, 500 ml, pint 568 ml, 250 ml small; wine: 125/175/250 ml glass, 750 bottle; spirit/shot 20/40/60 ml; cocktail: standard ~ 200ml) + custom ml input. Default ABV per type from catalog (editable, optional).
  - Quantity stepper (− 1 +), supports 0.5 steps.
  - Live estimate of standard drinks for the current size/ABV/quantity.
  - Time (defaults to now; editable datetime-local for back-logging), optional note.
  - Save → instant optimistic add + haptic (`navigator.vibrate(10)` if available) + toast with **Undo**.
- **QoL**: "Repeat last" button and a horizontal "Recent" quick-add row (one tap re-logs a recent drink with same type/size/ABV); favourites (star a recent); swipe-less edit/delete via tapping an entry → same sheet in edit mode with Delete; feed grouped by day with per-day drink count and std drinks; filter feed Mine / Everyone; estimated standard drinks (grams of alcohol = ml × abv/100 × 0.789; show units = g/10) — informational only; dark mode via prefers-color-scheme + manual toggle; share invite link via `navigator.share` fallback copy-to-clipboard; CSV export link; trip archive.
- **Stats screen**: trip totals (drinks, std drinks) plus your own; per-member leaderboard (drinks count, std drinks); by-category breakdown (simple CSS bars, no chart lib); by-day breakdown.
- Settings: display name, theme, change password, logout (warn if outbox non-empty), app version, "force full resync" button.
- Trips screen: list of trips (active first, archived collapsed), create trip (name), join via code field; each card shows my drinks count.
- Mobile: viewport-fit=cover, safe-area insets, min 44px tap targets, bottom nav (Log / Stats / Trip), `inputmode="decimal"` for ABV, no horizontal scroll at 360px width, fast (no layout thrash). Accessible labels.
- All mutating fetches send `X-Requested-With: trip-drinks` and `credentials: 'same-origin'`. On 401, go to login but keep local data & outbox for re-login by the same user (if a different user logs in, clear local DB first).
- Never render user-provided strings via innerHTML without escaping (XSS: trip names, drink names, notes, display names are shared across users).

## Docker
- Multi-stage not needed. `FROM node:24-alpine`, `WORKDIR /app`, copy package.json server public, `ENV NODE_ENV=production DATA_DIR=/data PORT=8080`, `VOLUME /data`, run as non-root `node` user (chown /data), `EXPOSE 8080`, `HEALTHCHECK` using `wget -qO- http://127.0.0.1:8080/healthz`, `CMD ["node","--disable-warning=ExperimentalWarning","server/index.js"]`.
- docker-compose.yml with named volume, restart unless-stopped, env examples commented.
- README: run locally (`npm start`), build/deploy on homelab, reverse proxy + HTTPS note (service workers need HTTPS or localhost; mention Caddy/Tailscale), backup = copy the sqlite file (or `sqlite3 .backup`), env vars.
