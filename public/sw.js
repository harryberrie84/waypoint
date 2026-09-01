// Waypoint service worker, hand-rolled, no build dependency.
//
// One job: keep the app launchable with no signal. The page data itself
// rehydrates from the localStorage mirror, so an offline launch lands on real
// content, not a spinner.
//
// Caching strategy, deliberately narrow so it never sits in front of the API:
//   - navigations  -> network first, fall back to the cached shell when offline
//   - hashed assets -> cache first (content-hashed names are safe to keep)
//   - /fonts/*      -> cache first (self-hosted, same origin, never changes)
//   - /api/*, SSE, everything else -> not intercepted, straight to network
// The cache is named after the build that registered this SW (main.tsx appends
// ?v=<build id>), so each deploy caches under a new key and `activate` deletes
// the previous one. It was pinned at 'waypoint-v1' through every deploy before
// this, which is the classic "it broke after the update" report: the shell from
// the first deploy kept being served long after it shipped.

const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `waypoint-${BUILD}`;
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icon.svg', '/icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: try the network so a fresh deploy loads, fall back to the
  // cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/'));
  if (!cacheable) return; // API, realtime SSE, and anything else: untouched.

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
