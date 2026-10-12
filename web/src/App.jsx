import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson } from './api.js';
import { loadCells, loadOrder } from './layout.js';
import { cacheConfig, cacheIcons, cacheServices, cachedConfig, cachedServices } from './offline.js';
import { useConnection } from './useConnection.js';
import { DRAG_SCALE } from './honeycomb.js';
import { useHoneycomb } from './useHoneycomb.js';
import { useTileReorder } from './useTileReorder.js';
import { ServiceTile, TodoTile } from './tiles.jsx';
import { TodoModal } from './TodoModal.jsx';

export default function App() {
  const [data, setData] = useState({ services: [], files: [], todos: [], lastBuild: null });
  // The last config seen, until the server answers: it carries the fallback
  // address, which matters most exactly when the server can't be reached.
  const [cfg, setCfg] = useState(() => cachedConfig() || { checkInterval: 30 });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [todosOpen, setTodosOpen] = useState(false);
  const [cells, setCells] = useState(loadCells);
  const [drag, setDrag] = useState(null); // { key, origin } of the tile in hand
  const order = useMemo(loadOrder, []);

  const { status, checking, target, check, markOnline } = useConnection(cfg);
  const offline = status === 'offline';

  // Monotonic request id: a slow response must never overwrite a newer one.
  const latestRequest = useRef(0);
  // Whether `data` came from the server in this page's lifetime (vs. the cache).
  const live = useRef(false);

  const load = useCallback(async (signal) => {
    const requestId = (latestRequest.current += 1);
    try {
      const json = await getJson('/api/services', { signal });
      if (requestId !== latestRequest.current) return; // superseded, discard
      live.current = true;
      setData(json);
      setError(null);
      markOnline();
      cacheServices(json);
      cacheIcons(json.services.map((s) => s.icon).filter(Boolean));
    } catch (e) {
      if (signal?.aborted) return; // unmounted, not an error worth showing
      if (requestId !== latestRequest.current) return;
      setError(e.message);
      check(); // the server gone, or just this request? the probe tells
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [check, markOnline]);

  const loadConfig = useCallback(async (signal) => {
    try {
      const json = await getJson('/api/config', { signal });
      setCfg(json);
      cacheConfig(json);
    } catch {
      /* keep the cached config */
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    loadConfig(ac.signal);
    load(ac.signal);
    return () => ac.abort();
  }, [load, loadConfig]);

  // Back from an outage: refresh now rather than at the next tick.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === 'offline' && status === 'online') {
      loadConfig();
      load();
    }
    prevStatus.current = status;
  }, [status, load, loadConfig]);

  // The server can't be reached and nothing came from it yet: show the
  // services as they were last seen rather than an empty screen.
  useEffect(() => {
    if (!offline || live.current) return;
    const snapshot = cachedServices();
    if (snapshot) setData(snapshot);
  }, [offline]);

  useEffect(() => {
    const ms = Math.max(5, cfg.checkInterval || 30) * 1000;
    const ac = new AbortController();
    const t = setInterval(() => load(ac.signal), ms);
    return () => {
      clearInterval(t);
      ac.abort();
    };
  }, [cfg.checkInterval, load]);

  // Only services with a resolvable port (hence a link) are shown.
  const services = useMemo(
    () => data.services.filter((s) => s.port).sort((a, b) => a.name.localeCompare(b.name)),
    [data.services],
  );

  // Tiles that make up the mosaic: one per service, plus the TODO widget.
  // Tiles the user has dragged into place come first, in the order they were
  // dropped; anything new (a service added to a compose file since) keeps its
  // alphabetical position at the end, so a rebuild never reshuffles the mosaic.
  const tiles = useMemo(() => {
    const t = services.map((s) => ({ type: 'service', key: s.id, service: s }));
    if (data.todos?.length) t.push({ type: 'todo', key: '__todo__', count: data.todos.length });
    if (!order.length) return t;
    const rank = new Map(order.map((k, i) => [k, i]));
    const at = (tile) => (rank.has(tile.key) ? rank.get(tile.key) : Number.MAX_SAFE_INTEGER);
    return t.sort((a, b) => at(a) - at(b)); // stable: unranked tiles stay A→Z
  }, [services, data.todos, order]);

  const { ref, positions, height, size, arrangement, origin } = useHoneycomb(tiles, cells, drag?.origin);
  const { onTilePointerDown, onTileClickCapture } = useTileReorder({
    mosaicRef: ref,
    tiles,
    positions,
    size,
    arrangement,
    origin,
    setDrag,
    setCells,
  });

  // Offline, the last known statuses say nothing about now.
  const showStatus = cfg.healthChecks && !offline;

  return (
    <div className="app">
      {status === 'switching' ? (
        <div className="toast toast-info" role="status">Switching to {target}…</div>
      ) : offline ? (
        <div className="toast" role="status">
          No connection to the server{tiles.length > 0 && ' — showing the last known services'}
          <button type="button" className="toast-btn" onClick={check} disabled={checking}>
            {checking ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : (
        error && <div className="toast">API unreachable — {error}</div>
      )}

      {!loading && !offline && tiles.length === 0 && (
        <p className="empty">No services found.</p>
      )}

      <div className={`mosaic${drag ? ' is-dragging' : ''}`} ref={ref} style={{ height }}>
        {tiles.map((tile, i) => {
          const p = positions[i];
          if (!p) return null;
          // Slots are transforms, not left/top: they animate on the compositor,
          // and the dragged tile can then be moved by writing two custom
          // properties, without React re-rendering on every pointer event.
          const dragging = drag?.key === tile.key;
          const dragProps = {
            style: {
              width: size,
              height: size,
              transform: dragging
                ? `translate3d(var(--drag-x, 0px), var(--drag-y, 0px), 0) scale(${DRAG_SCALE})`
                : `translate3d(${p.x}px, ${p.y}px, 0) scale(var(--tile-scale, 1))`,
            },
            dragging,
            onPointerDown: (e) => onTilePointerDown(e, tile.key),
            onClickCapture: onTileClickCapture,
          };
          return tile.type === 'service' ? (
            <ServiceTile key={tile.key} service={tile.service} showStatus={showStatus} {...dragProps} />
          ) : (
            <TodoTile key={tile.key} count={tile.count} {...dragProps} onClick={() => setTodosOpen(true)} />
          );
        })}
      </div>

      {todosOpen && <TodoModal todos={data.todos} onClose={() => setTodosOpen(false)} />}
    </div>
  );
}
