// Services from other machines: periodically fetch /api/host from every Dasha
// instance listed in HOSTS and publish what it exports into the store, next to
// the services found in the local compose files.
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';

/**
 * Create a poller for the HOSTS instances, bound to a store, the icon resolver
 * (remote icons are resolved and cached here, like local ones), config and a
 * fetch implementation. Which address of each host answered last, the timer
 * and the in-flight-pass guard live in the closure.
 */
export function createRemotes({ store, icons, config = defaultConfig, log = createLogger('remotes'), fetchImpl = fetch }) {
  let timer = null;
  let passRunning = false;
  // host name -> index into its urls of the address that answered last, tried
  // first next time so a dead LAN address doesn't cost a timeout on every pass.
  const preferred = new Map();

  function start() {
    if (!config.hosts.length) return;
    runPass();
    timer = setInterval(runPass, Math.max(5, config.hostInterval) * 1000);
    timer.unref?.();
    log.info(`fetching services from ${config.hosts.map((h) => h.name).join(', ')} every ${config.hostInterval}s`);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function runPass() {
    if (passRunning) {
      log.debug('previous host pass still running, skipping this tick');
      return;
    }
    passRunning = true;
    try {
      await Promise.all(config.hosts.map(syncHost));
    } finally {
      passRunning = false;
    }
  }

  async function syncHost(host) {
    const previous = store.getRemote(host.name);
    const fetched = await fetchHost(host);
    if (!fetched.ok) {
      if (previous?.ok !== false) log.warn(`host ${host.name} unreachable: ${fetched.error}`);
      // Keep showing what the host last exported — its services may well be up
      // even though this server can't reach it — but stop vouching for their
      // status.
      store.setRemote(host.name, {
        services: (previous?.services || []).map((s) => ({ ...s, status: 'unknown', statusCode: null, responseTime: null })),
        todos: previous?.todos || [],
        ok: false,
        error: fetched.error,
        lastFetch: previous?.lastFetch ?? null,
      });
      return;
    }
    if (previous?.ok === false) log.info(`host ${host.name} reachable again (${fetched.base})`);

    const { data } = fetched;
    const services = data.services.filter((s) => s && s.id && s.port).map((s) => toService(host, s, data.healthChecks));
    await resolveIcons(services, data.services);
    const todos = (Array.isArray(data.todos) ? data.todos : []).map((t) => ({
      keyword: t.keyword,
      text: t.text,
      line: t.line,
      file: `${host.name}: ${t.file}`,
      fileId: `${host.name}/${t.fileId}`,
    }));
    store.setRemote(host.name, { services, todos, ok: true, error: null, lastFetch: new Date().toISOString() });
    log.debug(`host ${host.name}: ${services.length} service(s), ${todos.length} TODO(s)`);
  }

  // GET /api/host from the host's addresses in turn, starting with the one
  // that answered last.
  async function fetchHost(host) {
    const first = preferred.get(host.name) || 0;
    const order = host.urls.map((_, i) => (first + i) % host.urls.length);
    let error = 'no address answered';
    for (const i of order) {
      const base = host.urls[i];
      try {
        const data = await fetchJson(`${base}/api/host`);
        if (data?.app !== 'dasha' || !Array.isArray(data.services)) throw new Error('not a Dasha instance');
        preferred.set(host.name, i);
        return { ok: true, base, data };
      } catch (err) {
        error = `${base}: ${err.message}`;
        log.debug(`host ${host.name} at ${base} failed`, err.message);
      }
    }
    return { ok: false, error };
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.hostTimeout);
    try {
      const res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'compose-dashboard/hosts' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('timed out');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // A remote service as the dashboard shows it. The id is prefixed with the
  // host name, so it never collides with a local one and the tile keeps its
  // place in the mosaic across fetches. `hostnames` are the addresses of the
  // host for the browser to pick its link from; the port is the host's own.
  function toService(host, s, healthChecks) {
    return {
      id: `${host.name}/${s.id}`,
      name: s.name || s.service,
      service: s.service,
      image: s.image,
      containerName: s.containerName,
      host: host.name,
      hostnames: host.hostnames,
      port: s.port,
      url: `http://${host.hostnames[0]}:${s.port}`,
      // Probed by the host itself; this server never checks a remote service.
      checkUrl: null,
      healthChecks: Boolean(healthChecks),
      icon: null,
      status: s.status || 'unknown',
      statusCode: s.statusCode ?? null,
      responseTime: s.responseTime ?? null,
      lastCheck: s.lastCheck ?? null,
    };
  }

  // Resolve icons from the exported candidates, a few at a time. The icon
  // resolver memoizes every candidate, so after the first pass this costs
  // nothing.
  async function resolveIcons(services, exported) {
    const candidatesById = new Map(exported.map((s) => [s.id, Array.isArray(s.iconCandidates) ? s.iconCandidates : []]));
    const remoteId = (svc) => svc.id.slice(svc.host.length + 1);
    const limit = Math.max(1, config.iconConcurrency);
    let next = 0;
    const worker = async () => {
      while (next < services.length) {
        const svc = services[next];
        next += 1;
        const candidates = candidatesById.get(remoteId(svc)).filter((c) => c && typeof c.value === 'string' && c.value);
        svc.icon = await icons.resolveIcon(candidates);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, services.length) }, worker));
  }

  return { start, stop, runPass };
}
