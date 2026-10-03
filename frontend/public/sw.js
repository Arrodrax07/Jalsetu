/* JalSetu service worker: lets the public portal open and accept complaints without a network.
 *
 * - Page loads (navigations): network first; offline -> the last cached copy of the app shell.
 * - Built assets (/assets/*, icons, fonts): cache first (file names are content-hashed).
 * - Public read-only API (places list, tap schedules, supply info): network first, cached copy when offline.
 * - Everything else (staff API, POSTs, auth, WebSocket) is never touched: it goes straight to the network.
 * Complaints written offline are queued by the page itself (src/citizen/outbox.ts), not here, so the
 * resident can see and manage them.
 */
const VERSION = 'jalsetu-v1';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const DATA = `${VERSION}-data`;
const SHELL_URLS = ['/', '/report', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

const PUBLIC_DATA = [/^\/api\/public\/communities$/, /^\/api\/public\/schedules$/, /^\/api\/public\/supply\//, /^\/api\/public\/summary$/];

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(fallbackUrl || request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackUrl || request) || (fallbackUrl ? await caches.match('/report') || await caches.match('/') : null);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(STATIC)).put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      // One cached shell serves every client-side route (/report, /water, /track, /).
      event.respondWith(networkFirst(req, SHELL, '/'));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (PUBLIC_DATA.some(r => r.test(url.pathname))) event.respondWith(networkFirst(req, DATA));
      return;
    }
    if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
      event.respondWith(cacheFirst(req));
      return;
    }
    // Development server modules (/src/..., /@vite/..., /node_modules/...): network first so edits show
    // immediately, with the last copy kept so the portal still opens offline during a demo.
    event.respondWith(networkFirst(req, STATIC));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req));
  }
});
