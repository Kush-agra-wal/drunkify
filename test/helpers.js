import { spawn } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_ENTRY = join(import.meta.dirname, '..', 'server', 'index.js');

export const randomPort = () => randomInt(18000, 19000);

function waitForListening(proc) {
  return new Promise((resolve, reject) => {
    let out = '';
    const onData = (buf) => {
      out += buf.toString();
      if (out.includes('listening on')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`server exited early (${code}): ${out}`));
    };
    const cleanup = () => {
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onData);
      proc.off('exit', onExit);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', onExit);
  });
}

export async function startServer(env = {}) {
  const ownDir = !env.DATA_DIR;
  const dataDir = env.DATA_DIR || mkdtempSync(join(tmpdir(), 'trip-drinks-test-'));
  const cleanup = () => ownDir && rmSync(dataDir, { recursive: true, force: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = randomPort();
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_ENTRY], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, TRUST_PROXY: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await waitForListening(proc);
    } catch (err) {
      if (String(err.message).includes('EADDRINUSE')) continue;
      cleanup();
      throw err;
    }
    const logs = [];
    proc.stdout.on('data', (b) => logs.push(b.toString()));
    proc.stderr.on('data', (b) => logs.push(b.toString()));
    const exited = new Promise((resolve) =>
      proc.once('exit', (code, signal) => {
        cleanup();
        resolve({ code, signal });
      }),
    );
    return {
      port,
      url: `http://127.0.0.1:${port}`,
      dataDir,
      proc,
      logs,
      exited,
      async stop() {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
        return exited;
      },
    };
  }
  cleanup();
  throw new Error('could not find a free port');
}

let ipCounter = 0;
export const uniqueIp = () => `10.${process.pid % 250}.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export class Client {
  constructor(base, { ip = uniqueIp() } = {}) {
    this.base = base;
    this.ip = ip;
    this.cookie = null;
    this.user = null;
  }

  async request(method, path, body, { headers = {}, csrf = true, raw = false } = {}) {
    const h = { 'x-forwarded-for': this.ip, ...headers };
    if (csrf) h['x-requested-with'] = 'trip-drinks';
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      h['content-type'] ??= 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(this.base + path, { method, headers: h, body: payload });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const value = setCookie.split(';')[0];
      this.cookie = value === 'sid=' ? null : value;
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  get(path, opts) {
    return this.request('GET', path, undefined, opts);
  }
  post(path, body, opts) {
    return this.request('POST', path, body, opts);
  }
  patch(path, body, opts) {
    return this.request('PATCH', path, body, opts);
  }
  del(path, opts) {
    return this.request('DELETE', path, undefined, opts);
  }

  async register(username = `u${randomUUID().slice(0, 8)}`, extra = {}) {
    const res = await this.post('/api/auth/register', { username, password: 'secret123', display_name: `Name ${username}`, ...extra });
    if (res.status !== 201) throw new Error(`register failed ${res.status} ${res.text}`);
    this.user = res.json.user;
    return this.user;
  }

  async createTrip(name = 'Prague') {
    const res = await this.post('/api/trips', { name });
    if (res.status !== 201) throw new Error(`createTrip failed ${res.status} ${res.text}`);
    return res.json.trip;
  }

  async join(code) {
    const res = await this.post('/api/trips/join', { invite_code: code });
    if (res.status !== 200) throw new Error(`join failed ${res.status} ${res.text}`);
    return res.json.trip;
  }

  sync(body) {
    return this.post('/api/sync', body);
  }
}

export function makeEntry(tripId, overrides = {}) {
  return {
    id: randomUUID(),
    trip_id: tripId,
    category: 'beer',
    name: 'Pilsner Urquell',
    volume_ml: 500,
    abv: 4.4,
    quantity: 1,
    consumed_at: new Date().toISOString(),
    note: '',
    updated_at: Date.now(),
    deleted: false,
    ...overrides,
  };
}
