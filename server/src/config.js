// Runtime configuration, resolved once from the environment.
// Every path here must be writable-tolerant so the container can run with
// a read-only root filesystem (icons + tmp live on mounted volumes/tmpfs).

function int(value, fallback) {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

/**
 * Parse a comma- or space-separated list of fallback addresses into origins
 * (`https://host[:port]`), keeping their order and dropping duplicates. Only
 * http(s) URLs with no path, query, hash or credentials are accepted — the rest
 * are returned as `rejected`, never handed to the browser to navigate to.
 */
export function parseFallbackUrls(value) {
  const urls = [];
  const rejected = [];
  for (const raw of String(value ?? '').split(/[\s,]+/).filter(Boolean)) {
    let url = null;
    try {
      url = new URL(raw);
    } catch {
      /* not a URL at all */
    }
    const ok =
      url &&
      /^https?:$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash;
    if (!ok) rejected.push(raw);
    else if (!urls.includes(url.origin)) urls.push(url.origin);
  }
  return { urls, rejected };
}

/**
 * Build the runtime configuration from an environment map. Kept as a factory
 * (rather than reading `process.env` inline) so tests can construct isolated
 * configs and the composition root stays the single place that reads the real
 * environment.
 */
export function loadConfig(env = process.env) {
  return {
    // Public hostname used to build the URLs shown on the cards (the host your
    // browser reaches the published ports on).
    appHost: env.APP_HOST || 'localhost',

    // Hostname the availability checker uses to reach services. Defaults to
    // APP_HOST, but inside a container `localhost` is the container itself — set
    // this to `host.docker.internal` (Docker Desktop) or the host's IP so probes
    // hit the host where the ports are actually published.
    checkHost: env.CHECK_HOST || env.APP_HOST || 'localhost',

    // Whether to probe services for availability at all. Off by default: the
    // dashboard should not reach out to other containers unless asked, so a
    // fresh install is a passive launcher until you opt in with HEALTH_CHECKS.
    healthChecks: bool(env.HEALTH_CHECKS, false),

    // Availability check interval, in seconds (only used when checks are on).
    checkInterval: int(env.CHECK_INTERVAL, 30),

    // HTTP port the dashboard listens on.
    port: int(env.PORT, 1337),

    // Root that is recursively scanned for compose files. May be a directory or
    // a single file. Mount your project(s) here, e.g. `- ./:/compose:ro`.
    composeDir: env.COMPOSE_DIR || '/compose',

    // Where downloaded SVG icons are cached. Must be writable (volume or tmpfs).
    iconsDir: env.ICONS_DIR || '/icons',

    // Per-request timeout for availability checks, in milliseconds.
    healthTimeout: int(env.HEALTH_TIMEOUT, 5000),

    // Iconify HTTP API base.
    iconifyApi: env.ICONIFY_API || 'https://api.iconify.design',

    // Per-request timeout for Iconify lookups, in milliseconds. Kept separate
    // from (and shorter than) healthTimeout: icons are cosmetic and must never
    // hold up a rebuild.
    iconTimeout: int(env.ICON_TIMEOUT, 3000),

    // How many icons to resolve in parallel during a rebuild.
    iconConcurrency: int(env.ICON_CONCURRENCY, 6),

    // Comma-separated service / image names (case-insensitive) hidden from the
    // dashboard. Defaults to hiding the dashboard's own service ("dasha") so it
    // doesn't show a card for itself.
    hideServices:
      env.HIDE_SERVICES?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) ||
      ['dasha'],

    // How many directory levels below COMPOSE_DIR to scan and watch. A compose
    // dir laid out as `<root>/<project>/compose.yaml` only needs a couple of
    // levels; a shallow limit keeps discovery off deep bind-mount data even
    // before IGNORE_DIRS prunes it. 0 = only files directly in the root.
    scanDepth: int(env.SCAN_DEPTH, 1),

    // Directory names never descended into when scanning or watching for compose
    // files. Bind-mount data lives next to compose files (e.g. `volumes/…`) and
    // can hold tens of thousands of files — watching them exhausts the inotify
    // limit (ENOSPC) and trips over other users' files (EACCES). Hidden dirs
    // (any starting with `.`) are always ignored on top of this list.
    ignoreDirs:
      env.IGNORE_DIRS?.split(',').map((s) => s.trim()).filter(Boolean) ||
      ['node_modules', '.git', '.svn', '.hg', 'volumes'],

    // Offline mode: a service worker caches the app (page, bundle, icons) so
    // the dashboard opens even while the server can't be reached. Off by
    // default; turning it off again makes browsers drop the worker and its
    // caches on their next visit. Needs HTTPS (or localhost) in the browser.
    offlineMode: bool(env.OFFLINE_MODE, false),

    // Other addresses of this same server — typically its Tailscale MagicDNS
    // name — as full URLs (`https://homeserver.tail1234.ts.net`). When the
    // address the browser opened the dashboard on stops answering, it tries
    // these in order and moves to the first one where the dashboard answers.
    // The one it is on is skipped, so the list may name every address the
    // server has (LAN included) and then works in both directions. Empty = none.
    fallbackUrls: parseFallbackUrls(env.FALLBACK_HOST).urls,

    // How long the browser waits for the server (or a fallback) to answer a
    // reachability probe before it counts it as unreachable, in milliseconds.
    connectTimeout: int(env.CONNECT_TIMEOUT, 3000),

    // While neither address answers, how often the browser tries again, in
    // seconds. It also retries whenever the network or the tab comes back.
    reconnectInterval: int(env.RECONNECT_INTERVAL, 15),

    // Log verbosity: debug | info | warn | error
    logLevel: env.LOG_LEVEL || 'info',
  };
}

// Default configuration read from the real process environment. The composition
// root (index.js) uses this; tests build their own via loadConfig({...}).
export const config = loadConfig();
