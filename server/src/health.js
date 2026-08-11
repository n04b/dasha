// Periodic availability checks. Each service with a URL is probed with an
// HTTP GET; the result maps to Online / Offline / Timeout.
import { config } from './config.js';
import { createLogger } from './logger.js';
import { store } from './state.js';

const log = createLogger('health');

let timer = null;
let passRunning = false;

export function startHealthChecks() {
  const intervalMs = Math.max(1, config.checkInterval) * 1000;
  // Kick off an immediate pass, then repeat on the configured interval.
  runPass();
  timer = setInterval(runPass, intervalMs);
  timer.unref?.();
  log.info(`health checks every ${config.checkInterval}s`);
}

export function stopHealthChecks() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function runPass() {
  // A slow pass must not overlap with the next tick, or probe load doubles.
  if (passRunning) {
    log.debug('previous health pass still running, skipping this tick');
    return;
  }
  passRunning = true;
  try {
    const services = store.listServices().filter((s) => s.checkUrl);
    await Promise.all(services.map(checkService));
  } finally {
    passRunning = false;
  }
}

async function checkService(svc) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.healthTimeout);

  let patch;
  try {
    const res = await fetch(svc.checkUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'compose-dashboard/health' },
    });
    // A 5xx means the service answered but is broken, so it is not "online".
    // 4xx stays online on purpose: an API that only serves /api legitimately
    // returns 404 at the root, and 401/403 still prove something is listening.
    patch = {
      status: res.status >= 500 ? 'offline' : 'online',
      statusCode: res.status,
      responseTime: Date.now() - started,
      lastCheck: new Date().toISOString(),
    };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    patch = {
      status: timedOut ? 'timeout' : 'offline',
      statusCode: null,
      responseTime: Date.now() - started,
      lastCheck: new Date().toISOString(),
    };
    log.debug(`${svc.name} ${patch.status} (${svc.checkUrl})`, err.message);
  } finally {
    clearTimeout(timeout);
  }

  const prev = svc.status;
  store.updateHealth(svc.id, patch);
  if (prev !== patch.status) {
    log.info(`${svc.name}: ${prev} -> ${patch.status} (${svc.checkUrl})`);
  }
}
