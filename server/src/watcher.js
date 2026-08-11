// Watch the compose directory and trigger a (debounced) rebuild whenever a
// compose file — or a `.env` feeding its variables — is created, changed or
// removed.
import path from 'node:path';
import chokidar from 'chokidar';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { isComposeFile } from './scanner.js';
import { rebuild } from './builder.js';

const log = createLogger('watcher');

// `.env` values are interpolated into compose files, so editing one changes the
// resulting services just as editing the compose file would.
function isWatched(filePath) {
  return isComposeFile(filePath) || path.basename(filePath) === '.env';
}

let watcher = null;
let debounce = null;

export function startWatcher() {
  watcher = chokidar.watch(config.composeDir, {
    ignored: /(^|[/\\])(\.git|node_modules)([/\\]|$)/,
    ignoreInitial: true,
    persistent: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const onEvent = (event) => (filePath) => {
    if (!isWatched(filePath)) return;
    log.info(`${event}: ${filePath}`);
    scheduleRebuild();
  };

  watcher
    .on('add', onEvent('added'))
    .on('change', onEvent('changed'))
    .on('unlink', onEvent('removed'))
    .on('error', (err) => log.error('watch error', err.message))
    .on('ready', () => log.info(`watching ${config.composeDir} for changes`));
}

function scheduleRebuild() {
  clearTimeout(debounce);
  debounce = setTimeout(() => rebuild(), 500);
}

export async function stopWatcher() {
  clearTimeout(debounce);
  if (watcher) await watcher.close();
  watcher = null;
}
