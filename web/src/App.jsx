import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STATUS_META = {
  online: { label: 'Online', cls: 'online' },
  offline: { label: 'Offline', cls: 'offline' },
  timeout: { label: 'Timeout', cls: 'timeout' },
  unknown: { label: 'Checking…', cls: 'unknown' },
  'no-url': { label: 'No URL', cls: 'nourl' },
};

const REQUEST_TIMEOUT = 10000;

// fetch() never times out on its own, so a hung server would leave the UI
// stuck on "Loading…" forever. Abort every request after REQUEST_TIMEOUT.
async function getJson(url, { signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('request timed out'), { name: 'AbortError' });
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export default function App() {
  const [data, setData] = useState({ services: [], files: [], todos: [], lastBuild: null });
  const [cfg, setCfg] = useState({ checkInterval: 30 });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [todosOpen, setTodosOpen] = useState(false);

  // Monotonic request id: a slow response must never overwrite a newer one.
  const latestRequest = useRef(0);

  const load = useCallback(async (signal) => {
    const requestId = (latestRequest.current += 1);
    try {
      const json = await getJson('/api/services', { signal });
      if (requestId !== latestRequest.current) return; // superseded, discard
      setData(json);
      setError(null);
    } catch (e) {
      if (signal?.aborted) return; // unmounted, not an error worth showing
      if (requestId !== latestRequest.current) return;
      setError(e.message);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    getJson('/api/config', { signal: ac.signal }).then(setCfg).catch(() => {});
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    const ms = Math.max(5, cfg.checkInterval || 30) * 1000;
    const ac = new AbortController();
    const t = setInterval(() => load(ac.signal), ms);
    return () => {
      clearInterval(t);
      ac.abort();
    };
  }, [cfg.checkInterval, load]);

  // Only services with a resolvable URL are shown.
  const services = useMemo(
    () => data.services.filter((s) => s.url).sort((a, b) => a.name.localeCompare(b.name)),
    [data.services],
  );

  // Tiles that make up the mosaic: one per service, plus the TODO widget.
  const tiles = useMemo(() => {
    const t = services.map((s) => ({ type: 'service', key: s.id, service: s }));
    if (data.todos?.length) t.push({ type: 'todo', key: '__todo__', count: data.todos.length });
    return t;
  }, [services, data.todos]);

  const { ref, positions, height, size } = useHoneycomb(tiles.length);

  return (
    <div className="app">
      {error && <div className="toast">API unreachable — {error}</div>}

      {!loading && tiles.length === 0 && (
        <p className="empty">No services found.</p>
      )}

      <div className="mosaic" ref={ref} style={{ height }}>
        {tiles.map((tile, i) => {
          const p = positions[i];
          if (!p) return null;
          const style = { left: p.x, top: p.y, width: size, height: size };
          return tile.type === 'service' ? (
            <ServiceTile key={tile.key} service={tile.service} style={style} />
          ) : (
            <TodoTile key={tile.key} count={tile.count} style={style} onClick={() => setTodosOpen(true)} />
          );
        })}
      </div>

      {todosOpen && <TodoModal todos={data.todos} onClose={() => setTodosOpen(false)} />}
    </div>
  );
}

function ServiceTile({ service, style }) {
  const meta = STATUS_META[service.status] || STATUS_META.unknown;
  const offline = service.status === 'offline';
  // Full-colour icon sets keep their brand colours; monochrome sets are drawn
  // as a white silhouette so they stay visible on the black tile.
  const colorful = /\/(logos|devicon|skill-icons|flat-color-icons|fxemoji|twemoji|noto)-/.test(service.icon);
  return (
    <a
      className={`tile${offline ? ' is-offline' : ''}`}
      style={style}
      href={service.url}
      target="_blank"
      rel="noreferrer noopener"
      title={`${service.name} · ${meta.label}`}
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

function TodoTile({ count, style, onClick }) {
  return (
    <button className="tile tile-widget" style={style} onClick={onClick} title={`${count} TODO / FIXME`}>
      <svg className="widget-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
      <span className="widget-count">{count}</span>
      <span className="tile-label">TODO</span>
    </button>
  );
}

function TodoModal({ todos, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const byFile = new Map();
    for (const t of todos) {
      if (!byFile.has(t.file)) byFile.set(t.file, []);
      byFile.get(t.file).push(t);
    }
    return [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [todos]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">TODO / FIXME · {todos.length}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {groups.map(([file, items]) => (
            <div key={file} className="todo-group">
              <div className="todo-group-file">{file}</div>
              <ul className="todo-list">
                {items.map((t, i) => (
                  <li key={i} className="todo-item">
                    <span className={`todo-kw ${t.keyword.toLowerCase()}`}>{t.keyword}</span>
                    <span className="todo-text">{t.text || '(no description)'}</span>
                    <span className="todo-loc">:{t.line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Lay out `count` circular tiles in a centered honeycomb, recomputed on resize.
function useHoneycomb(count) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return useMemo(() => ({ ref, ...computeLayout(count, width) }), [count, width]);
}

function computeLayout(count, width) {
  const D = 88; // tile diameter
  const gap = 16;
  const s = D + gap; // center-to-center spacing
  if (!width || count === 0) return { positions: [], height: 0, size: D };

  // Place tiles on a hexagonal grid, spiralling out from the centre so they
  // pack into a honeycomb cluster (Apple Watch-style) rather than plain rows.
  const cells = hexSpiral(count);
  const cx = cells.map((c) => s * (c.q + c.r / 2));
  const cy = cells.map((c) => s * (Math.sqrt(3) / 2) * c.r);
  const minX = Math.min(...cx);
  const maxX = Math.max(...cx);
  const minY = Math.min(...cy);
  const maxY = Math.max(...cy);

  const clusterW = maxX - minX + D;
  const clusterH = maxY - minY + D;
  const baseX = Math.max(0, (width - clusterW) / 2);

  const positions = cells.map((_, i) => ({ x: baseX + (cx[i] - minX), y: cy[i] - minY }));
  return { positions, height: clusterH, size: D };
}

// Axial hex coordinates spiralling out from the centre: 1, then rings of 6, 12…
function hexSpiral(n) {
  const cells = [{ q: 0, r: 0 }];
  const dirs = [
    [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
  ];
  for (let radius = 1; cells.length < n; radius += 1) {
    let q = dirs[4][0] * radius;
    let r = dirs[4][1] * radius;
    for (let side = 0; side < 6 && cells.length < n; side += 1) {
      for (let step = 0; step < radius && cells.length < n; step += 1) {
        cells.push({ q, r });
        q += dirs[side][0];
        r += dirs[side][1];
      }
    }
  }
  return cells.slice(0, n);
}
