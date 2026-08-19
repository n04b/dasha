// Runtime configuration, resolved once from the environment.
// Every path here must be writable-tolerant so the container can run with
// a read-only root filesystem (icons + tmp live on mounted volumes/tmpfs).

function int(value, fallback) {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
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

    // Availability check interval, in seconds.
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

    // Log verbosity: debug | info | warn | error
    logLevel: env.LOG_LEVEL || 'info',
  };
}

// Default configuration read from the real process environment. The composition
// root (index.js) uses this; tests build their own via loadConfig({...}).
export const config = loadConfig();
