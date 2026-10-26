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
 * Parse the HOSTS list of other Dasha instances whose services are added to
 * this dashboard: entries separated by `;` or newlines, each
 * `name=url[,url...]`, e.g. `nas=http://192.168.1.20:1337,http://nas.tail1234.ts.net:1337`.
 * Every URL is an address of the same host — the server fetches from the first
 * one that answers, and the browser links to whichever of their hostnames is
 * on the network it opened the dashboard on. Only http(s) URLs without
 * credentials, query or hash are accepted; anything else is returned as
 * `rejected`, as is an entry without a valid or with a duplicate name.
 */
export function parseHosts(value) {
  const hosts = [];
  const rejected = [];
  for (const entry of String(value ?? '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    const name = eq > 0 ? entry.slice(0, eq).trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || hosts.some((h) => h.name === name)) {
      rejected.push(entry);
      continue;
    }
    const urls = [];
    const rejectedBefore = rejected.length;
    for (const raw of entry.slice(eq + 1).split(/[\s,]+/).filter(Boolean)) {
      let url = null;
      try {
        url = new URL(raw);
      } catch {
        /* not a URL at all */
      }
      const ok = url && /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
      if (!ok) {
        rejected.push(`${name}=${raw}`);
        continue;
      }
      // Keep an optional path prefix (a host behind a reverse proxy), minus the
      // trailing slash, so `${base}/api/host` is always well-formed.
      const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
      if (!urls.includes(base)) urls.push(base);
    }
    if (!urls.length) {
      // Its bad URLs are reported already; an entry with none at all is not.
      if (rejected.length === rejectedBefore) rejected.push(entry);
      continue;
    }
    const hostnames = [...new Set(urls.map((u) => new URL(u).hostname))];
    hosts.push({ name, urls, hostnames });
  }
  return { hosts, rejected };
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

    // `dashboard` (default) serves the UI; `host` runs headless and only
    // exports this machine's services (`/api/host`) to a parent dashboard that
    // lists it in HOSTS — no frontend, no icon lookups, no HOSTS of its own.
    mode: String(env.MODE || '').trim().toLowerCase() === 'host' ? 'host' : 'dashboard',

    // Other Dasha instances (usually in host mode) whose services are added to
    // this dashboard. See parseHosts for the format. Empty = none.
    hosts: parseHosts(env.HOSTS).hosts,

    // How often the services of HOSTS are fetched, in seconds.
    hostInterval: int(env.HOST_INTERVAL, 30),

    // Per-request timeout when fetching from a host, in milliseconds.
    hostTimeout: int(env.HOST_TIMEOUT, 5000),

    // Log verbosity: debug | info | warn | error
    logLevel: env.LOG_LEVEL || 'info',
  };
}

// Default configuration read from the real process environment. The composition
// root (index.js) uses this; tests build their own via loadConfig({...}).
export const config = loadConfig();
