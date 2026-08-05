// Entry point: wire everything together, start listening, handle shutdown.
import { config } from './config.js';
import { createLogger } from './logger.js';
import { ensureIconsDir } from './icons.js';
import { rebuild } from './builder.js';
import { startHealthChecks, stopHealthChecks } from './health.js';
import { startWatcher, stopWatcher } from './watcher.js';
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

  await ensureIconsDir();
  await rebuild(); // initial scan before we start serving
  startHealthChecks();
  startWatcher();

  const app = createApp();
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

    stopHealthChecks();
    await stopWatcher().catch(() => {});

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
