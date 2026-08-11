// REST API + static asset serving.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { store } from './state.js';
import { rebuild } from './builder.js';
import { FALLBACK_SVG } from './icons.js';

const log = createLogger('api');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src -> project root -> web/dist
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // --- REST API -----------------------------------------------------------

  // Public config the frontend needs.
  app.get('/api/config', (_req, res) => {
    res.json({
      appHost: config.appHost,
      checkInterval: config.checkInterval,
      lastBuild: store.lastBuild,
    });
  });

  // All discovered services (without the noisy raw compose payload).
  app.get('/api/services', (_req, res) => {
    res.json({
      lastBuild: store.lastBuild,
      services: store.listServices(),
      todos: store.todos,
      files: store.listFiles().map(({ id, path: p, error }) => ({ id, path: p, error })),
    });
  });

  // Raw compose file content by id.
  app.get('/api/compose/:id', (req, res) => {
    const file = store.getFile(req.params.id);
    if (!file) return res.status(404).json({ error: 'not found' });
    res.json({ id: file.id, path: file.path, error: file.error, content: file.raw });
  });

  // Force a rebuild. Express 4 does not catch rejections from async handlers,
  // so a failed rebuild would leave the request hanging until the client gives
  // up — catch it here and always answer.
  app.post('/api/reload', async (_req, res) => {
    log.info('manual reload requested');
    try {
      await rebuild();
      res.json({ ok: true, services: store.listServices().length, lastBuild: store.lastBuild });
    } catch (err) {
      log.error('reload failed', err.stack || String(err));
      res.status(500).json({ ok: false, error: 'rebuild failed' });
    }
  });

  // Liveness/readiness endpoint for Docker HEALTHCHECK.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', services: store.services.size, lastBuild: store.lastBuild });
  });

  // --- Static assets ------------------------------------------------------

  // Built-in fallback icon, served inline so it works even when the icon cache
  // directory is not writable (e.g. a misconfigured read-only mount).
  app.get('/icons/default.svg', (_req, res) => {
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(FALLBACK_SVG);
  });

  // Locally cached icons.
  app.use(
    '/icons',
    express.static(config.iconsDir, { maxAge: '1h', fallthrough: true }),
  );

  // Built React frontend. Asset filenames are content-hashed so they can be
  // cached for a long time; index.html must not be cached, or an upgraded
  // container would keep serving a page that references the old bundle.
  app.use(
    express.static(WEB_DIST, {
      index: 'index.html',
      maxAge: '1y',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // SPA fallback for non-API routes.
  app.get(/^\/(?!api\/|icons\/|healthz).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
      if (err) res.status(200).type('text/plain').send('compose-dashboard API is running');
    });
  });

  return app;
}
