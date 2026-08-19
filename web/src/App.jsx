import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson } from './api.js';
import { loadCells, loadOrder } from './layout.js';
import { DRAG_SCALE } from './honeycomb.js';
import { useHoneycomb } from './useHoneycomb.js';
import { useTileReorder } from './useTileReorder.js';
import { ServiceTile, TodoTile } from './tiles.jsx';
import { TodoModal } from './TodoModal.jsx';

export default function App() {
  const [data, setData] = useState({ services: [], files: [], todos: [], lastBuild: null });
  const [cfg, setCfg] = useState({ checkInterval: 30 });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [todosOpen, setTodosOpen] = useState(false);
  const [cells, setCells] = useState(loadCells);
  const [drag, setDrag] = useState(null); // { key, origin } of the tile in hand
  const order = useMemo(loadOrder, []);

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

  return (
    <div className="app">
      {error && <div className="toast">API unreachable — {error}</div>}

      {!loading && tiles.length === 0 && (
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
            <ServiceTile key={tile.key} service={tile.service} {...dragProps} />
          ) : (
            <TodoTile key={tile.key} count={tile.count} {...dragProps} onClick={() => setTodosOpen(true)} />
          );
        })}
      </div>

      {todosOpen && <TodoModal todos={data.todos} onClose={() => setTodosOpen(false)} />}
    </div>
  );
}
