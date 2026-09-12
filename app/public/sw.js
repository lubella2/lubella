/*
 * LuBella service worker.
 *
 * Deliberately conservative. A shop's records must never be shown stale, so:
 *   • every API call (anything under /api, /rest, /auth, /storage) is network-
 *     only — a signed-in user never sees a cached sale, balance or statement;
 *   • navigations are network-first and fall back to the app shell so the app
 *     still opens on a weak connection;
 *   • only static build assets (hashed files, images, icons) are cached, which
 *     is what makes the second visit fast and the PWA installable.
 */
const VERSION = 'lubella-v1';
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;

/** Static things that are safe to serve from cache. */
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/brand/lubella-logo.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c) => c.addAll(['/'])),
      caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Anything whose staleness would be a lie. */
function isApiRequest(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/storage/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live data: straight to the network, never cached, never replayed.
  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigations: try the network, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed build assets, images and icons: cache-first is safe and fast.
  const isAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/brand/') ||
    url.pathname.startsWith('/demo/') ||
    /\.(?:js|css|woff2?|png|jpe?g|svg|webp|gif|ico)$/.test(url.pathname);

  if (!isAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return response;
      });
    }),
  );
});
