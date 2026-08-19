// Tiny leveled logger. No dependencies, writes structured-ish lines to stdout/stderr.
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level, scope, message, extra, threshold) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const tag = scope ? `[${scope}]` : '';
  const line = `${ts} ${level.toUpperCase().padEnd(5)} ${tag} ${message}`.trim();
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (extra !== undefined) {
    stream.write(`${line} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}\n`);
  } else {
    stream.write(`${line}\n`);
  }
}

export function createLogger(scope, level = config.logLevel) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  return {
    debug: (msg, extra) => emit('debug', scope, msg, extra, threshold),
    info: (msg, extra) => emit('info', scope, msg, extra, threshold),
    warn: (msg, extra) => emit('warn', scope, msg, extra, threshold),
    error: (msg, extra) => emit('error', scope, msg, extra, threshold),
  };
}
