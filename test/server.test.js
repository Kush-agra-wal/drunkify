import assert from 'node:assert/strict';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { CATEGORY_KEYS, NON_ALCOHOLIC_KEYS } from '../server/categories.js';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/auth.js';
import { MIGRATIONS } from '../server/db.js';
import { Client, startServer } from './helpers.js';

function rawGet(url, path, headers = {}) {
  return fetch(url + path, { headers, redirect: 'manual' });
}

describe('static files', () => {
  let srv;
  let dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'trip-drinks-public-'));
    const pub = join(dir, 'public');
    mkdirSync(join(pub, 'js'), { recursive: true });
    writeFileSync(join(pub, 'index.html'), `<!doctype html><title>Drunkify</title>${'<!-- pad -->'.repeat(100)}`);
    writeFileSync(join(pub, 'app.js'), `export const x = 1;\n${'// filler\n'.repeat(200)}`);
    writeFileSync(join(pub, 'js', 'mod.js'), 'export default 1;');
    writeFileSync(join(pub, 'manifest.webmanifest'), JSON.stringify({ name: 'Drunkify' }));
    writeFileSync(join(pub, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(pub, '.secret'), 'hidden');
    writeFileSync(join(dir, 'outside.txt'), 'outside');
    srv = await startServer({ PUBLIC_DIR: pub });
  });
  after(async () => {
    await srv.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test('serves files with correct MIME and no-cache', async () => {
    const cases = [
      ['/', 'text/html; charset=utf-8'],
      ['/index.html', 'text/html; charset=utf-8'],
      ['/app.js', 'text/javascript; charset=utf-8'],
      ['/js/mod.js', 'text/javascript; charset=utf-8'],
      ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
      ['/icon.svg', 'image/svg+xml'],
    ];
    for (const [path, type] of cases) {
      const res = await rawGet(srv.url, path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('content-type'), type, path);
      assert.equal(res.headers.get('cache-control'), 'no-cache', path);
      assert.ok(res.headers.get('etag'), path);
      await res.arrayBuffer();
    }
  });

  test('ETag conditional requests return 304', async () => {
    const res = await rawGet(srv.url, '/app.js');
    const etag = res.headers.get('etag');
    await res.text();
    const again = await rawGet(srv.url, '/app.js', { 'if-none-match': etag });
    assert.equal(again.status, 304);
    assert.equal(again.headers.get('etag'), etag);
  });

  test('gzip when accepted', async () => {
    const body = await new Promise((resolve, reject) => {
      request(`${srv.url}/app.js`, { headers: { 'accept-encoding': 'gzip, deflate' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ headers: res.headers, buf: Buffer.concat(chunks) }));
      })
        .on('error', reject)
        .end();
    });
    assert.equal(body.headers['content-encoding'], 'gzip');
    assert.equal(body.headers.vary, 'Accept-Encoding');
    assert.match(gunzipSync(body.buf).toString(), /^export const x = 1;/);
    const plain = await new Promise((resolve, reject) => {
      request(`${srv.url}/app.js`, { headers: { 'accept-encoding': 'identity' } }, (res) => {
        res.resume();
        resolve(res.headers);
      })
        .on('error', reject)
        .end();
    });
    assert.equal(plain['content-encoding'], undefined);
    assert.notEqual(plain.etag, body.headers.etag, 'gzip variant has its own etag');
  });

  test('SPA fallback for extensionless non-API paths; 404 otherwise', async () => {
    const spa = await rawGet(srv.url, '/trip/abc/stats');
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /Drunkify/);
    const missing = await rawGet(srv.url, '/missing.js');
    assert.equal(missing.status, 404);
    await missing.text();
    const api = await rawGet(srv.url, '/api/does-not-exist');
    assert.equal(api.status, 404);
    assert.ok((await api.json()).error);
  });

  test('path traversal and dotfiles are blocked', async () => {
    const get = (path) =>
      new Promise((resolve, reject) => {
        request({ host: '127.0.0.1', port: srv.port, path, method: 'GET' }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode, data }));
        })
          .on('error', reject)
          .end();
      });
    for (const path of ['/../outside.txt', '/%2e%2e/outside.txt', '/js/..%2f..%2foutside.txt', '/.secret', '/%2esecret', '/..%5coutside.txt', '/%00']) {
      const r = await get(path);
      assert.ok([400, 404].includes(r.status), `${path} -> ${r.status}`);
      assert.ok(!r.data.includes('outside') && !r.data.includes('hidden'), path);
    }
  });

  test('HEAD works and non-GET static is rejected', async () => {
    const head = await fetch(`${srv.url}/app.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    const post = await fetch(`${srv.url}/app.js`, { method: 'POST' });
    assert.equal(post.status, 405);
  });
});

describe('categories', () => {
  test('category keys match SPEC', () => {
    assert.deepEqual([...CATEGORY_KEYS], ['beer', 'wine', 'cocktail', 'spirit', 'shot', 'cider', 'seltzer', 'soft', 'other']);
    assert.deepEqual([...NON_ALCOHOLIC_KEYS], ['soft']);
  });

  const catalogPath = join(import.meta.dirname, '..', 'public', 'catalog.js');
  test('frontend catalog uses the same category keys', { skip: !existsSync(catalogPath) && 'public/catalog.js not present' }, () => {
    const keys = [...readFileSync(catalogPath, 'utf8').matchAll(/\bkey:\s*['"]([a-z]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(keys, [...CATEGORY_KEYS]);
  });
});

describe('lifecycle', () => {
  test('graceful shutdown on SIGTERM and data persists across restarts', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'trip-drinks-persist-'));
    try {
      const a = await startServer({ DATA_DIR: dataDir });
      const c = new Client(a.url);
      await c.register('persisted');
      a.proc.kill('SIGTERM');
      const exit = await a.exited;
      assert.equal(exit.code, 0);
      assert.ok(a.logs.join('').includes('SIGTERM'));

      const b = await startServer({ DATA_DIR: dataDir });
      const l = new Client(b.url);
      assert.equal((await l.post('/api/auth/login', { username: 'persisted', password: 'secret123' })).status, 200);
      b.proc.kill('SIGINT');
      assert.equal((await b.exited).code, 0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('migrations', () => {
  test('a v1 database is upgraded: legacy columns and tables dropped, old category remapped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trip-drinks-v1-'));
    const uid = '11111111-1111-4111-8111-111111111111';
    const tid = '22222222-2222-4222-8222-222222222222';
    const beer = '33333333-3333-4333-8333-333333333333';
    const legacy = '44444444-4444-4444-8444-444444444444';
    const v1 = new DatabaseSync(join(dir, 'trip-drinks.db'));
    v1.exec(MIGRATIONS[0]);
    v1.exec('PRAGMA user_version = 1');
    v1.prepare('INSERT INTO users (id, username, display_name, password_hash, default_currency, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, 'olduser', 'Old User', await hashPassword('secret123'), 'GBP', 1);
    v1.prepare('INSERT INTO trips (id, name, currency, owner_id, invite_code, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1, 1)')
      .run(tid, 'Old trip', 'CZK', uid, 'ABCDEFGH');
    v1.prepare('INSERT INTO trip_members (trip_id, user_id, joined_at) VALUES (?, ?, 1)').run(tid, uid);
    const ins = v1.prepare(
      `INSERT INTO entries (id, trip_id, user_id, category, name, volume_ml, abv, quantity, unit_price, currency, consumed_at, note, updated_at, deleted, server_seq)
       VALUES (?, ?, ?, ?, ?, 500, ?, 1, ?, 'CZK', '2026-06-01T20:00:00.000Z', '', 1, 0, ?)`,
    );
    ins.run(legacy, tid, uid, 'water', 'Tap', 0, null, 1);
    ins.run(beer, tid, uid, 'beer', 'Kozel', 4, 55, 2);
    v1.exec("UPDATE meta SET value = 2 WHERE key = 'server_seq'");
    v1.exec(`INSERT INTO fx_rates (id, base, rates_json, fetched_at, source) VALUES (1, 'EUR', '{"EUR":1}', 1, 'x')`);
    v1.close();

    const srv = await startServer({ DATA_DIR: dir });
    try {
      const c = new Client(srv.url);
      const login = await c.post('/api/auth/login', { username: 'olduser', password: 'secret123' });
      assert.equal(login.status, 200);
      assert.deepEqual(Object.keys(login.json.user).sort(), ['display_name', 'id', 'username']);
      const res = await c.sync({ trip_cursors: {} });
      assert.deepEqual(Object.keys(res.json.trips[0]).sort(), ['archived', 'created_at', 'id', 'invite_code', 'members', 'name', 'owner_id', 'updated_at']);
      const byId = Object.fromEntries(res.json.entries.map((e) => [e.id, e]));
      assert.equal(byId[beer].server_seq, 2);
      assert.equal(byId[legacy].category, 'soft');
      assert.equal(byId[legacy].server_seq, 3, 'remapped rows get a fresh server_seq so clients refetch them');
      for (const e of res.json.entries) assert.ok(!('unit_price' in e) && !('currency' in e));
      assert.equal((await c.get('/api/rates')).status, 404);
    } finally {
      await srv.stop();
    }

    const db = new DatabaseSync(join(dir, 'trip-drinks.db'));
    try {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
      const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
      assert.ok(!cols('entries').includes('unit_price') && !cols('entries').includes('currency'));
      assert.ok(!cols('users').includes('default_currency'));
      assert.ok(!cols('trips').includes('currency'));
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'fx_rates'").get().n, 0);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'server_seq'").get().value, 3);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
