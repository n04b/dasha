// Recursively find Docker Compose files under a root path.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('scanner');

const COMPOSE_NAMES = new Set([
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]);

const MAX_DEPTH = 12;

export function isComposeFile(filePath) {
  return COMPOSE_NAMES.has(path.basename(filePath).toLowerCase());
}

/**
 * Whether a directory name should never be descended into while scanning or
 * watching. Hidden dirs (anything starting with `.` — `.git`, `.esphome`,
 * `.storage`, …) are always skipped: they hold VCS internals, build caches and
 * other users' private files, none of which contain compose files but all of
 * which pile up file-watchers. `ignoreDirs` adds the data/volume dirs where
 * bind-mounts accumulate thousands of files.
 */
export function isIgnoredDir(name, ignoreDirs = defaultConfig.ignoreDirs) {
  if (!name || name === '.' || name === '..') return false;
  if (name.startsWith('.')) return true;
  return ignoreDirs.includes(name);
}

/**
 * Return the absolute paths of every compose file under `root`.
 * `root` may itself be a single compose file.
 */
export async function findComposeFiles(root) {
  let stat;
  try {
    stat = await fs.stat(root);
  } catch (err) {
    log.error(`scan root is not accessible: ${root}`, err.message);
    return [];
  }

  if (stat.isFile()) {
    return isComposeFile(root) ? [root] : [];
  }

  const found = [];
  await walk(root, 0, found);
  log.info(`found ${found.length} compose file(s) under ${root}`);
  for (const f of found) log.debug(`  · ${f}`);
  return found.sort();
}

async function walk(dir, depth, out) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    log.warn(`cannot read directory ${dir}`, err.message);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      await walk(full, depth + 1, out);
    } else if (entry.isFile() && isComposeFile(entry.name)) {
      out.push(full);
    }
  }
}
