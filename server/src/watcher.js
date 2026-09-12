// Watch the compose directory and trigger a (debounced) rebuild whenever a
// compose file — or a `.env` feeding its variables — is created, changed or
// removed.
import path from 'node:path';
import chokidar from 'chokidar';
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';
import { isComposeFile, isIgnoredDir } from './scanner.js';

// `.env` values are interpolated into compose files, so editing one changes the
// resulting services just as editing the compose file would.
function isWatched(filePath) {
  return isComposeFile(filePath) || path.basename(filePath) === '.env';
}

/**
 * Create a file watcher that triggers a debounced `rebuild` whenever a compose
 * file (or a `.env` feeding it) changes. `rebuild` is injected so the watcher
 * doesn't reach into the builder module directly.
 */
export function createWatcher({ rebuild, config = defaultConfig, log = createLogger('watcher') }) {
  let watcher = null;
  let debounce = null;

  function scheduleRebuild() {
    clearTimeout(debounce);
    debounce = setTimeout(() => rebuild(), 500);
  }

  // Prune whole subtrees chokidar would otherwise set a watcher on. A compose
  // dir sits next to its bind-mount data (`volumes/…`, `.esphome/…`); descending
  // into those exhausts the inotify limit and trips over other users' files, all
  // to watch trees that never hold a compose file. Any ignored segment prunes.
  function isIgnoredPath(p) {
    return p.split(/[/\\]/).some((seg) => isIgnoredDir(seg, config.ignoreDirs));
  }

  // The flood of ENOSPC/EACCES from an over-broad watch is worse than useless in
  // the log; collapse each kind to a single actionable line.
  function makeErrorHandler() {
    const seen = new Set();
    return (err) => {
      const code = err.code || 'error';
      if (code === 'ENOSPC') {
        if (!seen.has(code)) {
          seen.add(code);
          log.error(
            'hit the inotify watch limit (ENOSPC) — raise fs.inotify.max_user_watches ' +
              'or add busy data dirs to IGNORE_DIRS',
          );
        }
        return;
      }
      if (code === 'EACCES' || code === 'EPERM') {
        if (!seen.has(code)) {
          seen.add(code);
          log.warn(`cannot watch some paths (${code}) — skipping them`, err.path || '');
        }
        return;
      }
      log.error('watch error', err.message);
    };
  }

  function start() {
    watcher = chokidar.watch(config.composeDir, {
      ignored: (p) => isIgnoredPath(p),
      ignoreInitial: true,
      persistent: true,
      depth: config.scanDepth,
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
      .on('error', makeErrorHandler())
      .on('ready', () => log.info(`watching ${config.composeDir} for changes`));
  }

  async function stop() {
    clearTimeout(debounce);
    if (watcher) await watcher.close();
    watcher = null;
  }

  return { start, stop };
}
