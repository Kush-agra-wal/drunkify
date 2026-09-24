import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.map']);

export function createStatic(publicDir) {
  const root = resolve(publicDir);
  const cache = new Map();

  function load(file) {
    let st;
    try {
      st = statSync(file);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached;
    const body = readFileSync(file);
    const ext = extname(file).toLowerCase();
    const entry = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      body,
      type: MIME_TYPES[ext] || 'application/octet-stream',
      etag: `"${createHash('sha1').update(body).digest('base64url')}"`,
      gzip: COMPRESSIBLE.has(ext) && body.length > 512 ? gzipSync(body) : null,
    };
    cache.set(file, entry);
    return entry;
  }

  function resolveFile(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return { status: 400 };
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
    const segments = decoded.split('/').filter(Boolean);
    if (segments.some((s) => s === '..' || s.startsWith('.'))) return { status: 404 };
    const file = resolve(join(root, ...segments));
    if (file !== root && !file.startsWith(root + sep)) return { status: 404 };
    const entry = segments.length ? load(file) : null;
    if (entry) return { entry };
    const last = segments[segments.length - 1] || '';
    if (!extname(last)) {
      const index = load(join(root, 'index.html'));
      if (index) return { entry: index };
    }
    return { status: 404 };
  }

  return function serveStatic(req, res, pathname) {
    const { entry, status } = resolveFile(pathname);
    if (!entry) {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(status === 400 ? 'Bad request' : 'Not found');
      return;
    }
    const gzip = entry.gzip && acceptsGzip(req.headers['accept-encoding']);
    const etag = gzip ? `${entry.etag.slice(0, -1)}-gz"` : entry.etag;
    const headers = {
      'Content-Type': entry.type,
      'Cache-Control': 'no-cache',
      ETag: etag,
      Vary: 'Accept-Encoding',
    };
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const body = gzip ? entry.gzip : entry.body;
    if (gzip) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

function acceptsGzip(header) {
  if (!header) return false;
  return header.split(',').some((part) => {
    const [coding, ...params] = part.trim().split(';');
    if (coding.trim().toLowerCase() !== 'gzip' && coding.trim() !== '*') return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}
