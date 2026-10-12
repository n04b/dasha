// What keeps the dashboard usable without its server: the service worker that
// caches the app itself, and the last answers the API gave. Those are kept in
// localStorage — per browser, like the layout — so a dashboard opened while the
// server is unreachable still has its tiles (and its fallback address) to go on.
// The service worker deliberately never caches the API: this is the app's own
// record of what it last saw, and it knows the data is stale while using it.

const SERVICES_KEY = 'dasha.services.v1';
const CONFIG_KEY = 'dasha.config.v1';

export function registerServiceWorker() {
  // The dev server rebuilds on every save; a cache would only get in the way.
  if (!import.meta.env.PROD) return;
  // Service workers only exist in a secure context: https, or localhost.
  if (!('serviceWorker' in navigator)) {
    console.info('Dasha: offline mode needs HTTPS (or localhost) — running without it.');
    return;
  }
  const register = () =>
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Dasha: service worker registration failed', err);
    });
  // Don't compete with the first load for bandwidth.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

// Tell the service worker which icons the tiles use, so they are there offline.
export function cacheIcons(urls) {
  navigator.serviceWorker?.controller?.postMessage({ type: 'icons', urls });
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — offline simply has less to show */
  }
}

// The last /api/services payload, or null.
export function cachedServices() {
  const data = read(SERVICES_KEY);
  return Array.isArray(data?.services) ? data : null;
}

export function cacheServices(data) {
  write(SERVICES_KEY, data);
}

// The last /api/config payload, or null.
export function cachedConfig() {
  const cfg = read(CONFIG_KEY);
  return cfg && typeof cfg === 'object' ? cfg : null;
}

export function cacheConfig(cfg) {
  write(CONFIG_KEY, cfg);
}
