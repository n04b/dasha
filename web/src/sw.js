// Dasha's service worker — the template. It is never bundled: the plugin in
// vite.config.js emits it as /sw.js with VERSION (a hash of the build) and
// PRECACHE (every file the build produced) prepended.
//
// It is what lets the dashboard open when its server can't be reached:
// - pages: network first, the cached app shell if the server doesn't answer in time;
// - bundle assets, favicon, manifest: cache first (precached per build);
// - icons: the cached copy at once, refreshed in the background;
// - the API is never touched: data comes from the server, or not at all.
/* global VERSION, PRECACHE */

const SHELL_CACHE = `dasha-shell-${VERSION}`;
// Icons come from the server's icon cache, not the bundle, so they outlive a build.
const ICON_CACHE = 'dasha-icons';
// How long a page load waits for the server before the cached shell is used. A
// server that isn't there often doesn't refuse the connection either — packets
// to a home LAN address from elsewhere just vanish, and the browser would wait
// out its own, minute-long, timeout.
const NAVIGATION_TIMEOUT = 3000;

const isIcon = (url) => url.pathname.startsWith('/icons/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('dasha-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Other origins (the fallback probe among them) go straight to the network,
  // and so do the API, the health endpoint and this worker's own updates.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/sw.js') return;

  if (isIcon(url)) event.respondWith(staleWhileRevalidate(event, request));
  else if (request.mode === 'navigate') event.respondWith(navigate(request));
  else event.respondWith(cacheFirst(event, request));
});

async function navigate(request) {
  const network = fetch(request);
  network.catch(() => {}); // may be abandoned to the timeout below
  try {
    const response = await Promise.race([network, sleep(NAVIGATION_TIMEOUT)]);
    // A reverse proxy in front of a stopped container answers 502/503/504
    // itself; for the dashboard that is the server being down all the same.
    if (response && response.status < 500) return response;
  } catch {
    /* offline, DNS failure, connection refused */
  }
  // Every route is the same single-page app, so the precached `/` serves them all.
  return (await caches.match('/', { cacheName: SHELL_CACHE })) || network;
}

async function cacheFirst(event, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)));
  }
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(ICON_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  });
  if (!cached) return refresh;
  event.waitUntil(refresh.catch(() => {}));
  return cached;
}

// The page posts the icons its tiles use after every refresh. Icons drawn
// before this worker took control never passed through it, so without this the
// first visit would leave an offline mosaic without icons; it is also how icons
// no tile uses any more get dropped.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'icons' || !Array.isArray(event.data.urls)) return;
  const wanted = new Set();
  for (const raw of event.data.urls) {
    try {
      const url = new URL(raw, self.location.origin);
      if (url.origin === self.location.origin && isIcon(url)) wanted.add(url.href);
    } catch {
      /* not a URL — ignore */
    }
  }
  event.waitUntil(syncIcons(wanted));
});

async function syncIcons(wanted) {
  const cache = await caches.open(ICON_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  await Promise.all([
    ...[...have].filter((url) => !wanted.has(url)).map((url) => cache.delete(url)),
    ...[...wanted].filter((url) => !have.has(url)).map((url) => cache.add(url).catch(() => {})),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
