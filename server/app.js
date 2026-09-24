import { randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  clearCookie,
  createSession,
  deleteOtherSessions,
  deleteSession,
  hashPassword,
  loadSession,
  parseCookies,
  pruneExpiredSessions,
  RateLimiter,
  safeEqualString,
  sessionCookie,
  verifyPassword,
} from './auth.js';
import { nextSeq, openDb, transaction } from './db.js';
import { createStatic } from './static.js';
import {
  displayName,
  HttpError,
  isObject,
  isPassword,
  isUsername,
  isUuid,
  requireBody,
  tripName,
  validateEntry,
} from './validate.js';

const BODY_LIMIT = 256 * 1024;
const MAX_CHANGES = 500;
const PAGE_SIZE = 2000;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8080,
    dataDir: env.DATA_DIR || './data',
    publicDir: env.PUBLIC_DIR || join(import.meta.dirname, '..', 'public'),
    registrationCode: env.REGISTRATION_CODE || '',
    cookieSecure: env.COOKIE_SECURE === 'true',
    trustProxy: Math.max(0, Math.floor(Number(env.TRUST_PROXY) || 0)),
  };
}

const userJson = (u) => ({ id: u.id, username: u.username, display_name: u.display_name });

function entryJson(e) {
  return {
    id: e.id,
    trip_id: e.trip_id,
    user_id: e.user_id,
    category: e.category,
    name: e.name,
    volume_ml: e.volume_ml,
    abv: e.abv,
    quantity: e.quantity,
    consumed_at: e.consumed_at,
    note: e.note,
    updated_at: e.updated_at,
    deleted: Boolean(e.deleted),
    server_seq: e.server_seq,
  };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function createApp(config) {
  const db = openDb(config.dataDir);
  const serveStatic = createStatic(config.publicDir);
  const limiter = new RateLimiter({ max: 10, windowMs: 5 * 60 * 1000 });
  const pwLimiter = new RateLimiter({ max: 10, windowMs: 5 * 60 * 1000 });

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(
      'INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    trip: db.prepare('SELECT * FROM trips WHERE id = ?'),
    tripByCode: db.prepare('SELECT * FROM trips WHERE invite_code = ?'),
    member: db.prepare('SELECT 1 AS ok FROM trip_members WHERE trip_id = ? AND user_id = ?'),
    members: db.prepare(
      `SELECT u.id, u.display_name, u.username FROM trip_members m JOIN users u ON u.id = m.user_id
       WHERE m.trip_id = ? ORDER BY m.joined_at, u.username`,
    ),
    memberCount: db.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ?'),
    userTrips: db.prepare(
      `SELECT t.* FROM trips t JOIN trip_members m ON m.trip_id = t.id WHERE m.user_id = ?
       ORDER BY t.created_at DESC, t.id`,
    ),
    addMember: db.prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id, joined_at) VALUES (?, ?, ?)'),
    removeMember: db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?'),
    deleteTrip: db.prepare('DELETE FROM trips WHERE id = ?'),
    touchTrip: db.prepare('UPDATE trips SET updated_at = ? WHERE id = ?'),
    entry: db.prepare('SELECT * FROM entries WHERE id = ?'),
    upsertEntry: db.prepare(
      `INSERT INTO entries (id, trip_id, user_id, category, name, volume_ml, abv, quantity,
         consumed_at, note, updated_at, deleted, server_seq)
       VALUES (:id, :trip_id, :user_id, :category, :name, :volume_ml, :abv, :quantity,
         :consumed_at, :note, :updated_at, :deleted, :server_seq)
       ON CONFLICT(id) DO UPDATE SET category = excluded.category, name = excluded.name,
         volume_ml = excluded.volume_ml, abv = excluded.abv, quantity = excluded.quantity,
         consumed_at = excluded.consumed_at, note = excluded.note, updated_at = excluded.updated_at, deleted = excluded.deleted,
         server_seq = excluded.server_seq`,
    ),
  };

  function tripJson(t) {
    return {
      id: t.id,
      name: t.name,
      owner_id: t.owner_id,
      invite_code: t.invite_code,
      archived: Boolean(t.archived),
      created_at: t.created_at,
      updated_at: t.updated_at,
      members: q.members.all(t.id).map((m) => ({ id: m.id, display_name: m.display_name, username: m.username })),
    };
  }

  const userTrips = (userId) => q.userTrips.all(userId).map(tripJson);

  function newInviteCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
      if (!q.tripByCode.get(code)) return code;
    }
  }

  function memberTrip(tripId, userId) {
    const trip = q.trip.get(tripId);
    if (!trip || !q.member.get(tripId, userId)) throw new HttpError(404, 'Trip not found');
    return trip;
  }

  function ownedTrip(tripId, userId) {
    const trip = memberTrip(tripId, userId);
    if (trip.owner_id !== userId) throw new HttpError(403, 'Only the trip owner can do that');
    return trip;
  }

  // With TRUST_PROXY=n, skip n trusted hops from the right of X-Forwarded-For + socket address.
  function clientIp(req) {
    const remote = req.socket.remoteAddress || 'unknown';
    const xff = req.headers['x-forwarded-for'];
    if (!config.trustProxy || typeof xff !== 'string' || !xff.trim()) return remote;
    const hops = [...xff.split(',').map((s) => s.trim()).filter(Boolean), remote];
    return hops[Math.max(0, hops.length - 1 - config.trustProxy)];
  }

  function rateLimit(req, res, key = clientIp(req), lim = limiter) {
    const wait = lim.hit(key);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      throw new HttpError(429, 'Too many attempts, try again later');
    }
  }

  function startSession(ctx, userId) {
    ctx.res.setHeader('Set-Cookie', sessionCookie(createSession(db, userId), config.cookieSecure));
  }

  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(
      `^${pattern.replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      })}$`,
    );
    routes.push({ method, re, keys, handler, auth: opts.auth !== false });
  };

  route('GET', '/api/config', () => ({ registration_code_required: Boolean(config.registrationCode) }), { auth: false });

  route(
    'POST',
    '/api/auth/register',
    async (ctx) => {
      rateLimit(ctx.req, ctx.res);
      const body = requireBody(ctx.body);
      if (config.registrationCode) {
        if (typeof body.registration_code !== 'string' || !safeEqualString(body.registration_code, config.registrationCode)) {
          throw new HttpError(403, 'Invalid registration code');
        }
      }
      if (!isUsername(body.username)) throw new HttpError(400, 'Username must be 3–32 characters: letters, digits, _ . -');
      if (!isPassword(body.password)) throw new HttpError(400, 'Password must be at least 6 characters');
      const name = displayName(body.display_name);
      if (q.userByName.get(body.username)) throw new HttpError(409, 'Username is already taken');
      const hash = await hashPassword(body.password);
      const id = randomUUID();
      try {
        q.insertUser.run(id, body.username, name, hash, Date.now());
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Username is already taken');
        throw err;
      }
      startSession(ctx, id);
      return [201, { user: userJson(q.userById.get(id)) }];
    },
    { auth: false },
  );

  route(
    'POST',
    '/api/auth/login',
    async (ctx) => {
      rateLimit(ctx.req, ctx.res);
      const body = requireBody(ctx.body);
      const user = typeof body.username === 'string' && body.username.length <= 64 ? q.userByName.get(body.username) : undefined;
      const password = typeof body.password === 'string' ? body.password.slice(0, 1024) : '';
      const ok = await verifyPassword(password, user?.password_hash);
      if (!user || !ok) throw new HttpError(401, 'Wrong username or password');
      startSession(ctx, user.id);
      return { user: userJson(user) };
    },
    { auth: false },
  );

  route(
    'POST',
    '/api/auth/logout',
    (ctx) => {
      deleteSession(db, ctx.token);
      ctx.res.setHeader('Set-Cookie', clearCookie(config.cookieSecure));
      return { ok: true };
    },
    { auth: false },
  );

  route('GET', '/api/me', (ctx) => ({ user: userJson(ctx.user) }));

  route('PATCH', '/api/me', (ctx) => {
    const body = requireBody(ctx.body);
    const name = body.display_name === undefined ? ctx.user.display_name : displayName(body.display_name);
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, ctx.user.id);
    return { user: userJson(q.userById.get(ctx.user.id)) };
  });

  route('POST', '/api/me/password', async (ctx) => {
    rateLimit(ctx.req, ctx.res, `user:${ctx.user.id}`, pwLimiter);
    rateLimit(ctx.req, ctx.res, `ip:${clientIp(ctx.req)}`, pwLimiter);
    const body = requireBody(ctx.body);
    const user = q.userById.get(ctx.user.id);
    if (typeof body.current_password !== 'string' || !(await verifyPassword(body.current_password.slice(0, 1024), user.password_hash))) {
      throw new HttpError(403, 'Current password is incorrect');
    }
    if (!isPassword(body.new_password)) throw new HttpError(400, 'New password must be at least 6 characters');
    const hash = await hashPassword(body.new_password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    deleteOtherSessions(db, user.id, ctx.tokenHash);
    return { ok: true };
  });

  route('GET', '/api/trips', (ctx) => ({ trips: userTrips(ctx.user.id) }));

  route('POST', '/api/trips', (ctx) => {
    const body = requireBody(ctx.body);
    const name = tripName(body.name);
    let id = randomUUID();
    if (body.id !== undefined && body.id !== null) {
      if (!isUuid(body.id)) throw new HttpError(400, 'Trip id must be a UUID');
      id = body.id;
    }
    return transaction(db, () => {
      const existing = q.trip.get(id);
      if (existing) {
        if (existing.owner_id === ctx.user.id && q.member.get(id, ctx.user.id)) return [200, { trip: tripJson(existing) }];
        throw new HttpError(409, 'Trip id already in use');
      }
      const now = Date.now();
      db.prepare(
        'INSERT INTO trips (id, name, owner_id, invite_code, archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      ).run(id, name, ctx.user.id, newInviteCode(), now, now);
      q.addMember.run(id, ctx.user.id, now);
      return [201, { trip: tripJson(q.trip.get(id)) }];
    });
  });

  route('POST', '/api/trips/join', (ctx) => {
    const body = requireBody(ctx.body);
    const code = typeof body.invite_code === 'string' ? body.invite_code.trim().toUpperCase() : '';
    const trip = code ? q.tripByCode.get(code) : undefined;
    if (!trip) throw new HttpError(404, 'Invite code not found');
    if (!q.member.get(trip.id, ctx.user.id)) {
      const now = Date.now();
      transaction(db, () => {
        q.addMember.run(trip.id, ctx.user.id, now);
        q.touchTrip.run(now, trip.id);
      });
    }
    return { trip: tripJson(q.trip.get(trip.id)) };
  });

  route('GET', '/api/invite/:code', (ctx) => {
    const trip = q.tripByCode.get(ctx.params.code.trim().toUpperCase());
    if (!trip) throw new HttpError(404, 'Invite code not found');
    return { trip: { id: trip.id, name: trip.name, member_count: q.memberCount.get(trip.id).n } };
  });

  route('GET', '/api/trips/:id', (ctx) => ({ trip: tripJson(memberTrip(ctx.params.id, ctx.user.id)) }));

  route('PATCH', '/api/trips/:id', (ctx) => {
    const trip = ownedTrip(ctx.params.id, ctx.user.id);
    const body = requireBody(ctx.body);
    const name = body.name === undefined ? trip.name : tripName(body.name);
    let archived = trip.archived;
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') throw new HttpError(400, 'archived must be a boolean');
      archived = body.archived ? 1 : 0;
    }
    db.prepare('UPDATE trips SET name = ?, archived = ?, updated_at = ? WHERE id = ?').run(name, archived, Date.now(), trip.id);
    return { trip: tripJson(q.trip.get(trip.id)) };
  });

  route('DELETE', '/api/trips/:id', (ctx) => {
    const trip = ownedTrip(ctx.params.id, ctx.user.id);
    q.deleteTrip.run(trip.id);
    return { ok: true };
  });

  route('POST', '/api/trips/:id/invite/rotate', (ctx) => {
    const trip = ownedTrip(ctx.params.id, ctx.user.id);
    db.prepare('UPDATE trips SET invite_code = ?, updated_at = ? WHERE id = ?').run(newInviteCode(), Date.now(), trip.id);
    return { trip: tripJson(q.trip.get(trip.id)) };
  });

  route('POST', '/api/trips/:id/leave', (ctx) => {
    const trip = memberTrip(ctx.params.id, ctx.user.id);
    transaction(db, () => {
      if (trip.owner_id === ctx.user.id) {
        if (q.memberCount.get(trip.id).n > 1) {
          throw new HttpError(400, 'The owner cannot leave while other members remain; remove them or delete the trip');
        }
        q.deleteTrip.run(trip.id);
      } else {
        q.removeMember.run(trip.id, ctx.user.id);
        q.touchTrip.run(Date.now(), trip.id);
      }
    });
    return { ok: true };
  });

  route('DELETE', '/api/trips/:id/members/:userId', (ctx) => {
    const trip = ownedTrip(ctx.params.id, ctx.user.id);
    const target = ctx.params.userId;
    if (target === ctx.user.id) throw new HttpError(400, 'The owner cannot remove themselves');
    if (!q.member.get(trip.id, target)) throw new HttpError(404, 'Member not found');
    transaction(db, () => {
      q.removeMember.run(trip.id, target);
      db.prepare('UPDATE trips SET invite_code = ?, updated_at = ? WHERE id = ?').run(newInviteCode(), Date.now(), trip.id);
    });
    return { trip: tripJson(q.trip.get(trip.id)) };
  });

  route('GET', '/api/trips/:id/export.csv', (ctx) => {
    const trip = memberTrip(ctx.params.id, ctx.user.id);
    const rows = db
      .prepare(
        `SELECT e.*, u.display_name, u.username FROM entries e JOIN users u ON u.id = e.user_id
         WHERE e.trip_id = ? AND e.deleted = 0 ORDER BY e.consumed_at, e.server_seq`,
      )
      .all(trip.id);
    const header = ['consumed_at', 'member', 'username', 'category', 'name', 'volume_ml', 'abv', 'quantity', 'note'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([r.consumed_at, r.display_name, r.username, r.category, r.name, r.volume_ml, r.abv, r.quantity, r.note].map(csvCell).join(','));
    }
    const slug = trip.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'trip';
    const body = `﻿${lines.join('\r\n')}\r\n`;
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-drinks.csv"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(body);
    return undefined;
  });

  route('POST', '/api/sync', (ctx) => {
    const body = requireBody(ctx.body);
    const changes = body.changes === undefined ? [] : body.changes;
    if (!Array.isArray(changes)) throw new HttpError(400, 'changes must be an array');
    if (changes.length > MAX_CHANGES) throw new HttpError(400, `At most ${MAX_CHANGES} changes per request`);
    const perTrip = body.trip_cursors !== undefined;
    if (perTrip && !isObject(body.trip_cursors)) throw new HttpError(400, 'trip_cursors must be an object');
    const userId = ctx.user.id;

    const applied = [];
    const rejected = [];
    transaction(db, () => {
      const memberOf = new Set(q.userTrips.all(userId).map((t) => t.id));
      for (const change of changes) {
        const { entry, reason } = validateEntry(change);
        if (!entry) {
          rejected.push({ id: isObject(change) && typeof change.id === 'string' ? change.id : null, reason });
          continue;
        }
        if (!memberOf.has(entry.trip_id)) {
          rejected.push({ id: entry.id, reason: 'not_member' });
          continue;
        }
        const existing = q.entry.get(entry.id);
        if (existing) {
          if (existing.user_id !== userId) {
            rejected.push({ id: entry.id, reason: 'forbidden' });
            continue;
          }
          if (existing.trip_id !== entry.trip_id) {
            rejected.push({ id: entry.id, reason: 'trip_mismatch' });
            continue;
          }
          if (existing.updated_at >= entry.updated_at) {
            applied.push(entry.id);
            continue;
          }
        }
        q.upsertEntry.run({ ...entry, user_id: userId, server_seq: nextSeq(db) });
        applied.push(entry.id);
      }
    });

    const trips = userTrips(userId);
    const cursors = {};
    for (const t of trips) {
      let c = 0;
      if (perTrip) c = body.trip_cursors[t.id];
      else if (body.cursor !== undefined) c = body.cursor;
      cursors[t.id] = Number.isSafeInteger(c) && c > 0 ? c : 0;
    }
    let rows = [];
    if (trips.length) {
      const where = trips.map(() => '(trip_id = ? AND server_seq > ?)').join(' OR ');
      const params = trips.flatMap((t) => [t.id, cursors[t.id]]);
      rows = db.prepare(`SELECT * FROM entries WHERE ${where} ORDER BY server_seq LIMIT ${PAGE_SIZE + 1}`).all(...params);
    }
    const more = rows.length > PAGE_SIZE;
    if (more) rows = rows.slice(0, PAGE_SIZE);
    for (const r of rows) cursors[r.trip_id] = r.server_seq;

    const result = { entries: rows.map(entryJson), applied, rejected, trips, more };
    if (perTrip) {
      result.trip_cursors = cursors;
    } else {
      const input = Number.isSafeInteger(body.cursor) && body.cursor > 0 ? body.cursor : 0;
      result.cursor = rows.length ? rows[rows.length - 1].server_seq : input;
    }
    return result;
  });

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolveBody, reject) => {
      const declared = Number(req.headers['content-length']);
      if (declared > BODY_LIMIT) {
        reject(new HttpError(413, 'Request body too large'));
        req.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on('data', (chunk) => {
        if (failed) return;
        size += chunk.length;
        if (size > BODY_LIMIT) {
          failed = true;
          reject(new HttpError(413, 'Request body too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!failed) resolveBody(Buffer.concat(chunks));
      });
      req.on('error', (err) => {
        if (!failed) reject(err);
      });
    });
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    if (MUTATING.has(method) && req.headers['x-requested-with'] !== 'trip-drinks') {
      throw new HttpError(403, 'Missing or invalid X-Requested-With header');
    }
    let match = null;
    let pathAllowed = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathAllowed = true;
      if (r.method !== method) continue;
      match = { route: r, m };
      break;
    }
    if (!match) throw new HttpError(pathAllowed ? 405 : 404, pathAllowed ? 'Method not allowed' : 'Not found');
    const { route: r, m } = match;
    const params = {};
    try {
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
    } catch {
      throw new HttpError(400, 'Bad path');
    }

    const token = parseCookies(req.headers.cookie).sid;
    const ctx = { req, res, url, params, token, body: undefined, user: null, tokenHash: null };
    const session = loadSession(db, token);
    if (session) {
      ctx.user = session.user;
      ctx.tokenHash = session.tokenHash;
      if (session.refreshed) res.setHeader('Set-Cookie', sessionCookie(token, config.cookieSecure));
    }
    if (r.auth && !ctx.user) throw new HttpError(401, 'Not logged in');

    if (method !== 'GET' && method !== 'HEAD') {
      const raw = await readBody(req);
      if (raw.length) {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json');
        try {
          ctx.body = JSON.parse(raw.toString('utf8'));
        } catch {
          throw new HttpError(400, 'Invalid JSON body');
        }
      }
    }

    const out = await r.handler(ctx);
    if (out === undefined) return;
    if (Array.isArray(out)) sendJson(res, out[0], out[1]);
    else sendJson(res, 200, out);
  }

  async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400).end();
      return;
    }
    try {
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('ok');
        return;
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      serveStatic(req, res, url.pathname);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        if (err.status === 413) res.setHeader('Connection', 'close');
        sendJson(res, err.status, { error: err.message });
      } else {
        console.error('[server] unhandled error', err);
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
  }

  const server = createServer(handler);
  server.headersTimeout = 30000;
  server.requestTimeout = 60000;
  const pruneTimer = setInterval(() => {
    pruneExpiredSessions(db);
    limiter.prune();
    pwLimiter.prune();
  }, 60 * 60 * 1000);
  pruneTimer.unref();

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(pruneTimer);
    await new Promise((resolveClose) => {
      server.close(() => resolveClose());
      server.closeIdleConnections();
      setTimeout(() => server.closeAllConnections(), 5000).unref();
    });
    db.close();
  }

  return { server, db, close };
}
