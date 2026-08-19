// Turn a normalized service into a dashboard-ready descriptor:
// name, port, url and icon-candidate list, following the priority rules from the spec.
import { config as defaultConfig } from './config.js';

/**
 * Resolve the display name.
 * Priority: x-dasha-name -> service name.
 */
export function resolveName(service) {
  return service.ext.name || service.name;
}

/**
 * Resolve the published port the card links to.
 * Priority: x-dasha-port -> first published (host) port. Null when neither
 * exists (the service is only internally exposed, so it gets no link).
 */
export function resolvePort(service) {
  const explicit = service.ext.port != null ? Number(service.ext.port) : null;
  if (Number.isFinite(explicit)) return explicit;
  return firstPublishedPort(service);
}

/**
 * Resolve the display URL shown on the card (uses APP_HOST — the host the
 * user's browser reaches the service on). Kept for API consumers; the frontend
 * builds its own link from `port` + the host in the address bar.
 * Priority: x-dasha-port -> first published (host) port.
 */
export function resolveUrl(service, config = defaultConfig) {
  return buildUrl(service, config.appHost);
}

/**
 * Resolve the URL the availability checker probes (uses CHECK_HOST, which may
 * differ from APP_HOST when running inside a container).
 */
export function resolveCheckUrl(service, config = defaultConfig) {
  return buildUrl(service, config.checkHost);
}

function buildUrl(service, host) {
  const port = resolvePort(service);
  return port ? `http://${host}:${port}` : null;
}

function firstPublishedPort(service) {
  const published = service.ports.find((p) => p.published != null);
  return published ? published.published : null;
}

/**
 * Ordered list of icon search candidates.
 * Priority: x-dasha-icon -> service name -> image -> container name.
 * An x-dasha-icon that already looks like an Iconify id (prefix:name)
 * is returned as an explicit id so it is fetched verbatim.
 */
export function iconCandidates(service) {
  const candidates = [];
  if (service.ext.icon) {
    candidates.push({ value: service.ext.icon, explicit: service.ext.icon.includes(':') });
  }
  if (service.name) candidates.push({ value: service.name, explicit: false });
  if (service.image) candidates.push({ value: imageBaseName(service.image), explicit: false });
  if (service.containerName) candidates.push({ value: service.containerName, explicit: false });
  return candidates.filter((c) => c.value);
}

// "ghcr.io/library/grafana:9.5" -> "grafana"
export function imageBaseName(image) {
  if (!image) return null;
  const noTag = String(image).split('@')[0].split(':')[0];
  const last = noTag.split('/').pop();
  return last || null;
}
