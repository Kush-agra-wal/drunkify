const VERSION = '1.3.0';
const CACHE = `trip-drinks-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'catalog.js',
  'js/api.js',
  'js/dom.js',
  'js/sheet.js',
  'js/state.js',
  'js/stats.js',
  'js/store.js',
  'js/sync.js',
  'js/trip.js',
  'js/tripsettings.js',
  'js/ui.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-maskable.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('trip-drinks-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match(new URL('index.html', self.registration.scope).href).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
