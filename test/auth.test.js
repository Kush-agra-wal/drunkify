import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, startServer, uniqueIp } from './helpers.js';

describe('auth', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(async () => {
    await srv.stop();
  });

  test('healthz and config', async () => {
    const res = await fetch(`${srv.url}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
    const c = new Client(srv.url);
    const cfg = await c.get('/api/config');
    assert.deepEqual(cfg.json, { registration_code_required: false });
  });

  test('register sets cookie and returns user', async () => {
    const c = new Client(srv.url);
    const res = await c.post('/api/auth/register', { username: 'Alice', password: 'secret123', display_name: ' Alice A ' });
    assert.equal(res.status, 201);
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /^sid=[A-Za-z0-9_-]{43};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=7776000/);
    assert.doesNotMatch(setCookie, /Secure/);
    assert.deepEqual(Object.keys(res.json.user).sort(), ['display_name', 'id', 'username']);
    assert.equal(res.json.user.display_name, 'Alice A');
    const me = await c.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, 'Alice');
  });

  test('register validation and duplicate usernames (case-insensitive)', async () => {
    const c = new Client(srv.url);
    await c.register('dupe_user');
    const d = new Client(srv.url);
    assert.equal((await d.post('/api/auth/register', { username: 'DUPE_USER', password: 'secret123', display_name: 'X' })).status, 409);
    assert.equal((await d.post('/api/auth/register', { username: 'ab', password: 'secret123', display_name: 'X' })).status, 400);
    assert.equal((await d.post('/api/auth/register', { username: 'bad name', password: 'secret123', display_name: 'X' })).status, 400);
    assert.equal((await d.post('/api/auth/register', { username: 'a'.repeat(33), password: 'secret123', display_name: 'X' })).status, 400);
    assert.equal((await d.post('/api/auth/register', { username: 'okname', password: '12345', display_name: 'X' })).status, 400);
    assert.equal((await d.post('/api/auth/register', { username: 'okname', password: 'secret123', display_name: '' })).status, 400);
    assert.equal((await d.post('/api/auth/register', { username: 'okname', password: 'secret123', display_name: 'x'.repeat(41) })).status, 400);
    const ok = await d.post('/api/auth/register', { username: 'okname', password: 'secret123', display_name: 'X' });
    assert.equal(ok.status, 201);
  });

  test('login, logout and session invalidation', async () => {
    const c = new Client(srv.url);
    await c.register('bob.b');
    const first = c.cookie;
    const bad = new Client(srv.url);
    const wrong = await bad.post('/api/auth/login', { username: 'bob.b', password: 'nope-nope' });
    assert.equal(wrong.status, 401);
    assert.ok(wrong.json.error);
    const unknown = await bad.post('/api/auth/login', { username: 'nobody_here', password: 'secret123' });
    assert.equal(unknown.status, 401);

    const l = new Client(srv.url);
    const login = await l.post('/api/auth/login', { username: 'BOB.B', password: 'secret123' });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.username, 'bob.b');
    assert.notEqual(l.cookie, first);

    const out = await l.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.deepEqual(out.json, { ok: true });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    const stale = new Client(srv.url);
    stale.cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await stale.get('/api/me')).status, 401);
    assert.equal((await c.get('/api/me')).status, 200, 'other session unaffected');
  });

  test('unauthenticated access is rejected', async () => {
    const c = new Client(srv.url);
    assert.equal((await c.get('/api/me')).status, 401);
    assert.equal((await c.get('/api/trips')).status, 401);
    assert.equal((await c.post('/api/sync', { changes: [] })).status, 401);
    c.cookie = 'sid=garbage';
    assert.equal((await c.get('/api/me')).status, 401);
  });

  test('CSRF header required on mutating requests', async () => {
    const c = new Client(srv.url);
    const noHeader = await c.post('/api/auth/register', { username: 'csrfuser', password: 'secret123', display_name: 'C' }, { csrf: false });
    assert.equal(noHeader.status, 403);
    assert.match(noHeader.json.error, /X-Requested-With/);
    await c.register('csrfuser');
    const wrongValue = await c.post('/api/trips', { name: 'T' }, { csrf: false, headers: { 'x-requested-with': 'XMLHttpRequest' } });
    assert.equal(wrongValue.status, 403);
    assert.equal((await c.patch('/api/me', { display_name: 'Z' }, { csrf: false })).status, 403);
    assert.equal((await c.post('/api/auth/logout', undefined, { csrf: false })).status, 403);
    assert.equal((await c.get('/api/me', { csrf: false })).status, 200, 'GET does not need the header');
  });

  test('JSON-only bodies and size limit', async () => {
    const c = new Client(srv.url);
    await c.register();
    const form = await c.post('/api/trips', 'name=x', { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    const broken = await c.post('/api/trips', '{nope');
    assert.equal(broken.status, 400);
    const arr = await c.post('/api/trips', '[]');
    assert.equal(arr.status, 400);
    const big = await c.post('/api/trips', { name: 'x', pad: 'a'.repeat(300 * 1024) });
    assert.equal(big.status, 413);
  });

  test('PATCH /api/me and password change', async () => {
    const c = new Client(srv.url);
    await c.register('pwuser');
    const other = new Client(srv.url);
    await other.post('/api/auth/login', { username: 'pwuser', password: 'secret123' });

    const p = await c.patch('/api/me', { display_name: 'New Name' });
    assert.equal(p.status, 200);
    assert.deepEqual(p.json.user, { id: c.user.id, username: 'pwuser', display_name: 'New Name' });
    assert.equal((await c.patch('/api/me', { display_name: '   ' })).status, 400);

    assert.equal((await c.post('/api/me/password', { current_password: 'wrong-one', new_password: 'newsecret' })).status, 403);
    assert.equal((await c.post('/api/me/password', { current_password: 'secret123', new_password: '123' })).status, 400);
    const ok = await c.post('/api/me/password', { current_password: 'secret123', new_password: 'newsecret' });
    assert.equal(ok.status, 200);
    assert.equal((await c.get('/api/me')).status, 200, 'current session kept');
    assert.equal((await other.get('/api/me')).status, 401, 'other sessions revoked');
    const n = new Client(srv.url);
    assert.equal((await n.post('/api/auth/login', { username: 'pwuser', password: 'secret123' })).status, 401);
    assert.equal((await n.post('/api/auth/login', { username: 'pwuser', password: 'newsecret' })).status, 200);
  });

  test('rate limit: 10 login/register attempts per 5 min per IP (rightmost untrusted hop)', async () => {
    const ip = '203.0.113.77';
    const c = new Client(srv.url, { ip });
    for (let i = 0; i < 10; i++) {
      const r = await c.post('/api/auth/login', { username: 'nobody_x', password: 'whatever1' });
      assert.equal(r.status, 401);
    }
    const limited = await c.post('/api/auth/login', { username: 'nobody_x', password: 'whatever1' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    const reg = await c.post('/api/auth/register', { username: 'limited1', password: 'secret123', display_name: 'L' });
    assert.equal(reg.status, 429);
    for (const spoof of ['5.5.5.11', '5.5.5.22, 1.2.3.4']) {
      const s = new Client(srv.url, { ip: `${spoof}, ${ip}` });
      assert.equal((await s.post('/api/auth/login', { username: 'nobody_x', password: 'whatever1' })).status, 429, 'spoofed left hops do not bypass');
    }
    const otherIp = new Client(srv.url);
    assert.equal((await otherIp.post('/api/auth/login', { username: 'nobody_x', password: 'whatever1' })).status, 401);
  });

  test('password change is rate limited per user', async () => {
    const c = new Client(srv.url);
    await c.register();
    for (let i = 0; i < 10; i++) {
      const r = await c.post('/api/me/password', { current_password: `wrong${i}xx`, new_password: 'whatever1' });
      assert.equal(r.status, 403);
    }
    c.ip = uniqueIp();
    const limited = await c.post('/api/me/password', { current_password: 'secret123', new_password: 'whatever1' });
    assert.equal(limited.status, 429);
  });
});

describe('X-Forwarded-For without TRUST_PROXY', () => {
  let srv;
  before(async () => {
    srv = await startServer({ TRUST_PROXY: '' });
  });
  after(async () => {
    await srv.stop();
  });

  test('header is ignored, so rotating it cannot bypass the limit', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await new Client(srv.url).post('/api/auth/login', { username: 'nobody_y', password: 'whatever1' });
      assert.equal(r.status, 401);
    }
    const r = await new Client(srv.url).post('/api/auth/login', { username: 'nobody_y', password: 'whatever1' });
    assert.equal(r.status, 429);
  });
});

describe('registration code', () => {
  let srv;
  before(async () => {
    srv = await startServer({ REGISTRATION_CODE: 'letmein', COOKIE_SECURE: 'true' });
  });
  after(async () => {
    await srv.stop();
  });

  test('register requires the code when configured', async () => {
    const c = new Client(srv.url);
    assert.deepEqual((await c.get('/api/config')).json, { registration_code_required: true });
    assert.equal((await c.post('/api/auth/register', { username: 'coded', password: 'secret123', display_name: 'C' })).status, 403);
    assert.equal((await c.post('/api/auth/register', { username: 'coded', password: 'secret123', display_name: 'C', registration_code: 'wrong' })).status, 403);
    const ok = await c.post('/api/auth/register', { username: 'coded', password: 'secret123', display_name: 'C', registration_code: 'letmein' });
    assert.equal(ok.status, 201);
    assert.match(ok.headers.get('set-cookie'), /; Secure/);
  });
});
