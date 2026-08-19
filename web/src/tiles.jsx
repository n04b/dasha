// The two kinds of mosaic tile — a service card and the TODO widget — plus the
// status vocabulary and the browser-relative link helper they share.

export const STATUS_META = {
  online: { label: 'Online', cls: 'online' },
  offline: { label: 'Offline', cls: 'offline' },
  timeout: { label: 'Timeout', cls: 'timeout' },
  unknown: { label: 'Checking…', cls: 'unknown' },
  'no-url': { label: 'No URL', cls: 'nourl' },
};

// The server can't know which host is reachable from wherever the dashboard is
// being viewed, so it publishes the service's `port` and leaves the host to the
// client: whatever is in the address bar. Open the dashboard at server.local and
// the tiles point at server.local; reach it by IP and they follow.
export function linkFor(service) {
  if (service.port) return `http://${window.location.hostname}:${service.port}`;
  return service.url || '#'; // no published port: fall back to whatever the API gave
}

export function ServiceTile({ service, style, dragging, onPointerDown, onClickCapture }) {
  const meta = STATUS_META[service.status] || STATUS_META.unknown;
  const offline = service.status === 'offline';
  const href = linkFor(service);
  // Full-colour icon sets keep their brand colours; monochrome sets are drawn
  // as a white silhouette so they stay visible on the black tile.
  const colorful = /\/(logos|devicon|skill-icons|flat-color-icons|fxemoji|twemoji|noto)-/.test(service.icon);
  return (
    <a
      className={`tile${offline ? ' is-offline' : ''}${dragging ? ' is-dragging' : ''}`}
      style={style}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`${service.name} · ${meta.label}`}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onDragStart={(e) => e.preventDefault()} // native link dragging fights ours
      draggable={false}
    >
      {colorful ? (
        <img className="tile-img" src={service.icon} alt="" loading="lazy" />
      ) : (
        <span className="tile-icon" style={{ '--icon-src': `url("${service.icon}")` }} />
      )}
      <span className="tile-label">{service.name}</span>
    </a>
  );
}

export function TodoTile({ count, style, onClick, dragging, onPointerDown, onClickCapture }) {
  return (
    <button
      className={`tile tile-widget${dragging ? ' is-dragging' : ''}`}
      style={style}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      title={`${count} TODO / FIXME`}
    >
      <svg className="widget-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
      <span className="widget-count">{count}</span>
      <span className="tile-label">TODO</span>
    </button>
  );
}
