// Orchestrates a full rebuild: scan -> parse -> resolve -> cache icons ->
// publish into the in-memory store. Rebuilds are serialized and coalesced.
import { config } from './config.js';
import { createLogger } from './logger.js';
import { findComposeFiles } from './scanner.js';
import path from 'node:path';
import { parseComposeFile } from './parser.js';
import { resolveName, resolveUrl, resolveCheckUrl, iconCandidates, imageBaseName } from './resolver.js';
import { resolveIcon } from './icons.js';
import { scanComposeText } from './todos.js';
import { store } from './state.js';

const log = createLogger('builder');

let building = false;
let queued = false;

export async function rebuild() {
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
      const url = resolveUrl(svc);
      const checkUrl = resolveCheckUrl(svc);
      const icon = await resolveIcon(iconCandidates(svc));
      services.push({
        id: `${svc.fileId}:${svc.name}`,
        fileId: svc.fileId,
        filePath: svc.filePath,
        name: resolveName(svc),
        service: svc.name,
        image: svc.image,
        containerName: svc.containerName,
        url,
        checkUrl,
        icon,
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

  store.replaceAll(files, services, todos);
  log.info(
    `rebuild complete: ${files.length} file(s), ${services.length} service(s), ${todos.length} TODO(s) in ${Date.now() - started}ms`,
  );
}

// A service is hidden when its service key, container name or image base name
// matches one of the configured HIDE_SERVICES entries.
function isHiddenService(svc) {
  const image = imageBaseName(svc.image);
  const names = [svc.name, svc.containerName, image].filter(Boolean).map((n) => n.toLowerCase());
  return names.some((n) => config.hideServices.includes(n));
}
