// Parse a compose file into normalized service descriptors.
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { createLogger } from './logger.js';

const log = createLogger('parser');

export function hashId(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/**
 * Read and parse one compose file.
 * Returns { id, path, raw, services: [...] } or { id, path, raw, error }.
 */
export async function parseComposeFile(filePath) {
  const id = hashId(filePath);
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    log.error(`cannot read ${filePath}`, err.message);
    return { id, path: filePath, raw: '', error: `read error: ${err.message}`, services: [] };
  }

  let doc;
  try {
    // parseDocument keeps node ranges, so we can map each service to its lines.
    doc = YAML.parseDocument(raw);
  } catch (err) {
    log.error(`invalid YAML in ${filePath}`, err.message);
    return { id, path: filePath, raw, error: `yaml error: ${err.message}`, services: [] };
  }
  if (doc.errors?.length) {
    return { id, path: filePath, raw, error: `yaml error: ${doc.errors[0].message}`, services: [] };
  }

  const js = doc.toJS() || {};
  const servicesRoot = js.services;
  if (!servicesRoot || typeof servicesRoot !== 'object') {
    return { id, path: filePath, raw, error: 'no services block', services: [] };
  }

  const servicesNode = doc.get('services', true);
  const services = Object.entries(servicesRoot).map(([name, def]) => {
    const pair = servicesNode?.items?.find((p) => String(p.key) === name);
    const range = serviceLineRange(pair, raw);
    return normalizeService(name, def || {}, id, filePath, range);
  });

  log.info(`parsed ${filePath}: ${services.length} service(s)`);
  return { id, path: filePath, raw, services };
}

// 1-based [start, end] line range a service occupies in the compose file,
// extended upward over any immediately preceding `#` comment lines so a TODO
// written just above the service key is attributed to it. Returns null if the
// range can't be determined.
function serviceLineRange(pair, raw) {
  const startOff = pair?.key?.range?.[0];
  const endOff = pair?.value?.range?.[1] ?? pair?.key?.range?.[2];
  if (startOff == null || endOff == null) return null;

  let start = lineNumberAt(raw, startOff);
  const end = lineNumberAt(raw, endOff);

  const lines = raw.split('\n');
  for (let i = start - 2; i >= 0 && lines[i].trim().startsWith('#'); i -= 1) {
    start = i + 1;
  }
  return { start, end };
}

function lineNumberAt(text, index) {
  let count = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function normalizeService(name, def, fileId, filePath, range) {
  return {
    fileId,
    filePath,
    name,
    range,
    image: def.image ?? null,
    containerName: def.container_name ?? null,
    labels: normalizeLabels(def.labels),
    environment: normalizeEnv(def.environment),
    ports: normalizePorts(def.ports),
    networks: normalizeNetworks(def.networks),
    // Dashboard extensions (x-dasha-* keys on the service).
    ext: {
      name: def['x-dasha-name'] ?? null,
      icon: def['x-dasha-icon'] ?? null,
      port: def['x-dasha-port'] ?? null,
    },
  };
}

// Labels may be a map or a list of "key=value" strings.
function normalizeLabels(labels) {
  if (!labels) return {};
  if (Array.isArray(labels)) {
    const out = {};
    for (const item of labels) {
      const [k, ...rest] = String(item).split('=');
      out[k] = rest.join('=');
    }
    return out;
  }
  if (typeof labels === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(labels)) out[k] = v == null ? '' : String(v);
    return out;
  }
  return {};
}

// Environment may be a map or a list of "KEY=value" strings.
function normalizeEnv(env) {
  if (!env) return {};
  if (Array.isArray(env)) {
    const out = {};
    for (const item of env) {
      const [k, ...rest] = String(item).split('=');
      out[k] = rest.join('=');
    }
    return out;
  }
  if (typeof env === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(env)) out[k] = v == null ? '' : String(v);
    return out;
  }
  return {};
}

// Ports normalize to [{ published, target, protocol }]. published may be null
// when a port is only exposed (short form "80") without a host mapping.
function normalizePorts(ports) {
  if (!Array.isArray(ports)) return [];
  const out = [];
  for (const p of ports) {
    if (p == null) continue;
    if (typeof p === 'object') {
      // Long syntax.
      out.push({
        published: p.published != null ? Number(p.published) : null,
        target: p.target != null ? Number(p.target) : null,
        protocol: p.protocol || 'tcp',
      });
      continue;
    }
    // Short syntax: "8080:80", "127.0.0.1:8080:80", "80", "80/udp", "8000-8001:8000-8001"
    const str = String(p);
    const [spec, proto] = str.split('/');
    const parts = spec.split(':');
    let published = null;
    let target = null;
    if (parts.length === 1) {
      target = firstPort(parts[0]);
    } else if (parts.length === 2) {
      published = firstPort(parts[0]);
      target = firstPort(parts[1]);
    } else {
      // ip:published:target
      published = firstPort(parts[parts.length - 2]);
      target = firstPort(parts[parts.length - 1]);
    }
    out.push({ published, target, protocol: proto || 'tcp' });
  }
  return out;
}

function firstPort(range) {
  const n = parseInt(String(range).split('-')[0], 10);
  return Number.isFinite(n) ? n : null;
}

// Networks may be a list or a map keyed by network name.
function normalizeNetworks(networks) {
  if (!networks) return [];
  if (Array.isArray(networks)) return networks.map(String);
  if (typeof networks === 'object') return Object.keys(networks);
  return [];
}
