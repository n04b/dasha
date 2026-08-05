// Recursively find Docker Compose files under a root path.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('scanner');

const COMPOSE_NAMES = new Set([
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]);

// Directories we never want to descend into.
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg']);

const MAX_DEPTH = 12;

export function isComposeFile(filePath) {
  return COMPOSE_NAMES.has(path.basename(filePath).toLowerCase());
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
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(full, depth + 1, out);
    } else if (entry.isFile() && isComposeFile(entry.name)) {
      out.push(full);
    }
  }
}
