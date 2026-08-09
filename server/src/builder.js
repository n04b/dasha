// Orchestrates a full rebuild: scan -> parse -> resolve -> cache icons ->
// publish into the in-memory store. Rebuilds are serialized and coalesced.
import { config } from './config.js';
import { createLogger } from './logger.js';
import { findComposeFiles } from './scanner.js';
import path from 'node:path';
import { parseComposeFile } from './parser.js';
import { resolveName, resolveUrl, iconCandidates } from './resolver.js';
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

  for (const filePath of paths) {
    const parsed = await parseComposeFile(filePath);
    files.push({ id: parsed.id, path: parsed.path, raw: parsed.raw, error: parsed.error || null });
    if (parsed.error) continue;

    // Find TODO/FIXME comments in the compose file once, then attribute each to
    // the service whose block contains it.
    const fileTodos = scanComposeText(parsed.raw);
    const relPath = path.relative(config.composeDir, parsed.path) || path.basename(parsed.path);

    for (const svc of parsed.services) {
      const url = resolveUrl(svc);
      const icon = await resolveIcon(iconCandidates(svc));
      const todoItems = svc.range
        ? fileTodos
            .filter((t) => t.line >= svc.range.start && t.line <= svc.range.end)
            .map((t) => ({ ...t, file: relPath }))
        : [];
      if (todoItems.length) log.info(`${svc.name}: ${todoItems.length} TODO(s) in ${relPath}`);
      services.push({
        id: `${svc.fileId}:${svc.name}`,
        fileId: svc.fileId,
        filePath: svc.filePath,
        name: resolveName(svc),
        service: svc.name,
        image: svc.image,
        containerName: svc.containerName,
        url,
        icon,
        labels: svc.labels,
        environment: svc.environment,
        ports: svc.ports,
        networks: svc.networks,
        // TODO/FIXME comments found within this service's block in the compose file.
        todos: todoItems.length,
        todoItems: todoItems.slice(0, 50),
        // Health fields, filled in by the checker.
        status: url ? 'unknown' : 'no-url',
        statusCode: null,
        responseTime: null,
        lastCheck: null,
      });
    }
  }

  store.replaceAll(files, services);
  log.info(
    `rebuild complete: ${files.length} file(s), ${services.length} service(s) in ${Date.now() - started}ms`,
  );
}
