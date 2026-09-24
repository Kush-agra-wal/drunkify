export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

const TIMEOUT_MS = 20000;

export async function api(method, path, body) {
  const headers = { 'X-Requested-With': 'trip-drinks', Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(path, { method, headers, credentials: 'same-origin', signal: ctl.signal, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new HttpError(0, ctl.signal.aborted ? 'The server took too long to respond' : 'You appear to be offline');
    }
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = await res.json().catch(() => null);
    if (ctl.signal.aborted) throw new HttpError(0, 'The server took too long to respond');
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
      throw new HttpError(res.status, data?.error || `Request failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
