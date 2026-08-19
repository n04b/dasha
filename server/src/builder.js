// Orchestrates a full rebuild: scan -> parse -> resolve -> cache icons ->
// publish into the in-memory store. Rebuilds are serialized and coalesced.
import path from 'node:path';
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';
import { findComposeFiles } from './scanner.js';
import { parseComposeFile } from './parser.js';
import { resolveName, resolveUrl, resolveCheckUrl, resolvePort, iconCandidates, imageBaseName } from './resolver.js';
import { scanComposeText } from './todos.js';

/**
 * Create a rebuild orchestrator bound to a store, icon resolver and config.
 * The serialize/coalesce state (`building`/`queued`) lives in the closure, so
 * the returned `rebuild` is safe to share and easy to drive from a test.
 */
export function createBuilder({ store, icons, config = defaultConfig, log = createLogger('builder') }) {
  let building = false;
  let queued = false;

  async function rebuild() {
    // Coalesce concurrent triggers into a single trailing rebuild.
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      await doRebuild();
    } finally {
      building = false;
      if (queued) {
        queued = false;
        rebuild();
      }
    }
  }

  async function doRebuild() {
    const started = Date.now();
    const paths = await findComposeFiles(config.composeDir);

    const files = [];
    const services = [];
    const todos = [];

    for (const filePath of paths) {
      const parsed = await parseComposeFile(filePath);
      files.push({ id: parsed.id, path: parsed.path, raw: parsed.raw, error: parsed.error || null });
      if (parsed.error) continue;

      // Collect all TODO/FIXME comments in the compose file into the shared list
      // shown as a dedicated block on the dashboard.
      const relPath = path.relative(config.composeDir, parsed.path) || path.basename(parsed.path);
      const fileTodos = scanComposeText(parsed.raw).map((t) => ({ ...t, file: relPath, fileId: parsed.id }));
      if (fileTodos.length) log.info(`${relPath}: ${fileTodos.length} TODO(s)`);
      todos.push(...fileTodos);

      for (const svc of parsed.services) {
        if (isHiddenService(svc)) {
          log.info(`hiding service ${svc.name} (matches HIDE_SERVICES)`);
          continue;
        }
        const port = resolvePort(svc);
        const url = resolveUrl(svc, config);
        const checkUrl = resolveCheckUrl(svc, config);
        services.push({
          id: `${svc.fileId}:${svc.name}`,
          fileId: svc.fileId,
          filePath: svc.filePath,
          name: resolveName(svc),
          service: svc.name,
          image: svc.image,
          containerName: svc.containerName,
          // `port` is the source of truth for the card link; the client combines
          // it with the host in its own address bar. `url` (built from APP_HOST)
          // is kept only as a convenience for API consumers.
          port,
          url,
          checkUrl,
          // Filled in below, in parallel — icon lookups hit the network.
          icon: null,
          iconCandidates: iconCandidates(svc),
          labels: svc.labels,
          environment: svc.environment,
          ports: svc.ports,
          networks: svc.networks,
          // Health fields, filled in by the checker.
          status: url ? 'unknown' : 'no-url',
          statusCode: null,
          responseTime: null,
          lastCheck: null,
        });
      }
    }

    await resolveIcons(services);

    store.replaceAll(files, services, todos);
    log.info(
      `rebuild complete: ${files.length} file(s), ${services.length} service(s), ${todos.length} TODO(s) in ${Date.now() - started}ms`,
    );
  }

  // Resolve every service icon with a bounded number of parallel lookups, so a
  // slow Iconify API costs one timeout per batch instead of one per service.
  async function resolveIcons(services) {
    const limit = Math.max(1, config.iconConcurrency);
    let next = 0;
    const worker = async () => {
      while (next < services.length) {
        const svc = services[next];
        next += 1;
        svc.icon = await icons.resolveIcon(svc.iconCandidates);
        delete svc.iconCandidates; // internal detail, not part of the API payload
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, services.length) }, worker));
  }

  // A service is hidden when its service key, container name or image base name
  // matches one of the configured HIDE_SERVICES entries.
  function isHiddenService(svc) {
    const image = imageBaseName(svc.image);
    const names = [svc.name, svc.containerName, image].filter(Boolean).map((n) => n.toLowerCase());
    return names.some((n) => config.hideServices.includes(n));
  }

  return { rebuild };
}
