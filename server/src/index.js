// Composition root: construct every component, inject their dependencies, wire
// them together, start listening and handle shutdown. This is the one place
// that reads the real environment and owns the singletons.
import { config } from './config.js';
import { createLogger } from './logger.js';
import { createStore } from './state.js';
import { createIcons } from './icons.js';
import { createBuilder } from './builder.js';
import { createHealthChecker } from './health.js';
import { createWatcher } from './watcher.js';
import { createApp } from './api.js';

const log = createLogger('main');

async function main() {
  log.info('starting compose-dashboard', {
    port: config.port,
    composeDir: config.composeDir,
    iconsDir: config.iconsDir,
    appHost: config.appHost,
    checkInterval: config.checkInterval,
  });

  // Build the object graph. Each component gets exactly the collaborators it
  // needs; nothing reaches across modules for a shared singleton.
  const store = createStore();
  const icons = createIcons({ config, log: createLogger('icons') });
  const builder = createBuilder({ store, icons, config, log: createLogger('builder') });
  const health = createHealthChecker({ store, config, log: createLogger('health') });
  const watcher = createWatcher({ rebuild: builder.rebuild, config, log: createLogger('watcher') });

  await icons.ensureIconsDir();
  await builder.rebuild(); // initial scan before we start serving
  health.start();
  watcher.start();

  const app = createApp({ store, rebuild: builder.rebuild, config, log: createLogger('api') });
  const server = app.listen(config.port, () => {
    log.info(`listening on http://0.0.0.0:${config.port}`);
  });

  // Track sockets so graceful shutdown can close idle keep-alives promptly.
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down gracefully`);

    health.stop();
    await watcher.stop().catch(() => {});

    const forced = setTimeout(() => {
      log.warn('forced shutdown after timeout');
      process.exit(1);
    }, 10000);
    forced.unref();

    server.close(() => {
      clearTimeout(forced);
      log.info('http server closed, bye');
      process.exit(0);
    });
    // Nudge idle keep-alive connections closed.
    for (const socket of sockets) socket.end();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', err.stack || String(err));
  });
  process.on('unhandledRejection', (err) => {
    log.error('unhandled rejection', err instanceof Error ? err.stack : String(err));
  });
}

main().catch((err) => {
  log.error('fatal startup error', err.stack || String(err));
  process.exit(1);
});
