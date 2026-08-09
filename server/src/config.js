// Runtime configuration, resolved once from the environment.
// Every path here must be writable-tolerant so the container can run with
// a read-only root filesystem (icons + tmp live on mounted volumes/tmpfs).

function int(value, fallback) {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  // Public hostname used to build the URLs shown on the cards (the host your
  // browser reaches the published ports on).
  appHost: process.env.APP_HOST || 'localhost',

  // Hostname the availability checker uses to reach services. Defaults to
  // APP_HOST, but inside a container `localhost` is the container itself — set
  // this to `host.docker.internal` (Docker Desktop) or the host's IP so probes
  // hit the host where the ports are actually published.
  checkHost: process.env.CHECK_HOST || process.env.APP_HOST || 'localhost',

  // Availability check interval, in seconds.
  checkInterval: int(process.env.CHECK_INTERVAL, 30),

  // HTTP port the dashboard listens on.
  port: int(process.env.PORT, 1337),

  // Root that is recursively scanned for compose files. May be a directory or
  // a single file. Mount your project(s) here, e.g. `- ./:/compose:ro`.
  composeDir: process.env.COMPOSE_DIR || '/compose',

  // Where downloaded SVG icons are cached. Must be writable (volume or tmpfs).
  iconsDir: process.env.ICONS_DIR || '/icons',

  // Per-request timeout for availability checks, in milliseconds.
  healthTimeout: int(process.env.HEALTH_TIMEOUT, 5000),

  // Iconify HTTP API base.
  iconifyApi: process.env.ICONIFY_API || 'https://api.iconify.design',

  // Log verbosity: debug | info | warn | error
  logLevel: process.env.LOG_LEVEL || 'info',
};
