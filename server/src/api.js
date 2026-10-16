// REST API + static asset serving.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';
import { FALLBACK_SVG } from './icons.js';
import { redactMap, redactComposeText } from './redact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src -> project root -> web/dist
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

/**
 * Build the Express app. The store, the rebuild trigger and config are injected
 * so the router owns no global state and can be exercised in isolation.
 */
export function createApp({ store, rebuild, config = defaultConfig, log = createLogger('api') }) {
  const app = express();
  app.disable('x-powered-by');

  // --- REST API -----------------------------------------------------------

  // Public config the frontend needs.
  app.get('/api/config', (_req, res) => {
    res.json({
      appHost: config.appHost,
      healthChecks: config.healthChecks,
      checkInterval: config.checkInterval,
      lastBuild: store.lastBuild,
      offlineMode: config.offlineMode,
      // Where the browser looks for this server, in order, when it can't reach
      // it on the address it is on.
      fallbackUrls: config.fallbackUrls,
      connectTimeout: config.connectTimeout,
      reconnectInterval: config.reconnectInterval,
    });
  });

  // Reachability probe for the browser: is the server there, and — asked from
  // another origin — is the fallback address really this dashboard? It reveals
  // nothing, so it answers any origin (CORS, plus the Private Network Access
  // preflight Chromium may send before a request into a private network), and
  // it must never be served from a cache.
  const PING_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  app.options('/api/ping', (_req, res) => {
    res
      .set({
        ...PING_HEADERS,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      })
      .sendStatus(204);
  });
  app.get('/api/ping', (_req, res) => {
    res.set(PING_HEADERS).json({ app: 'dasha' });
  });

  // All discovered services. Secret-looking environment/label values are masked
  // — compose files routinely hold passwords and anyone who can reach the
  // dashboard can call this endpoint.
  app.get('/api/services', (_req, res) => {
    res.json({
      lastBuild: store.lastBuild,
      services: store.listServices().map((s) => ({
        ...s,
        environment: redactMap(s.environment),
        labels: redactMap(s.labels),
      })),
      todos: store.todos,
      files: store.listFiles().map(({ id, path: p, error }) => ({ id, path: p, error })),
    });
  });

  // Compose file content by id, with secret values masked.
  app.get('/api/compose/:id', (req, res) => {
    const file = store.getFile(req.params.id);
    if (!file) return res.status(404).json({ error: 'not found' });
    res.json({
      id: file.id,
      path: file.path,
      error: file.error,
      content: redactComposeText(file.raw),
    });
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

  // Locally cached icons. An SVG fetched from an icon URL is arbitrary markup
  // on our origin, so forbid it from running scripts if opened directly.
  app.use(
    '/icons',
    express.static(config.iconsDir, {
      maxAge: '1h',
      fallthrough: true,
      setHeaders: (res) => res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"),
    }),
  );

  // Built React frontend. Asset filenames are content-hashed so they can be
  // cached for a long time; index.html must not be cached, or an upgraded
  // container would keep serving a page that references the old bundle. The
  // same goes for the service worker (an upgrade is noticed by its bytes
  // changing) and the web app manifest.
  app.use(
    express.static(WEB_DIST, {
      index: 'index.html',
      maxAge: '1y',
      setHeaders: (res, filePath) => {
        if (/\.(html|webmanifest)$/.test(filePath) || path.basename(filePath) === 'sw.js') {
          res.setHeader('Cache-Control', 'no-cache');
        }
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
