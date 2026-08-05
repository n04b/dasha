// Turn a normalized service into a dashboard-ready descriptor:
// name, url and icon-candidate list, following the priority rules from the spec.
import { config } from './config.js';

/**
 * Resolve the display name.
 * Priority: x-dasha-name -> service name.
 */
export function resolveName(service) {
  return service.ext.name || service.name;
}

/**
 * Resolve the URL used for the card link and availability checks.
 * Priority: x-dasha-port -> first published (host) port.
 * Both are exposed on APP_HOST.
 */
export function resolveUrl(service) {
  const explicit = service.ext.port != null ? Number(service.ext.port) : null;
  const port = Number.isFinite(explicit) ? explicit : firstPublishedPort(service);
  if (!port) return null;
  return `http://${config.appHost}:${port}`;
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
