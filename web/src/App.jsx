import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const STATUS_META = {
  online: { label: 'Online', cls: 'online' },
  offline: { label: 'Offline', cls: 'offline' },
  timeout: { label: 'Timeout', cls: 'timeout' },
  unknown: { label: 'Checking…', cls: 'unknown' },
  'no-url': { label: 'No URL', cls: 'nourl' },
};

const REQUEST_TIMEOUT = 10000;

// Where the tiles sit is a per-browser preference: the services themselves come
// from the compose files, and the server has nothing to persist a layout in.
const LAYOUT_KEY = 'dasha.tile-layout.v2';
// Superseded by the layout above, but still read once so that a mosaic arranged
// before free placement existed keeps the order it was given.
const ORDER_KEY = 'dasha.tile-order.v1';

// { [tile key]: [u, v] } — the honeycomb cell each hand-placed tile occupies.
function loadCells() {
  const cells = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    for (const [key, cell] of Object.entries(parsed || {})) {
      if (Array.isArray(cell) && cell.length === 2 && cell.every(Number.isInteger)) cells[key] = cell;
    }
  } catch {
    /* unreadable layout: fall back to the automatic one */
  }
  return cells;
}

function saveCells(cells) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(cells));
  } catch {
    /* private mode / quota — the layout simply won't survive a reload */
  }
}

function loadOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

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

  // Only services with a resolvable URL are shown.
  const services = useMemo(
    () => data.services.filter((s) => s.url).sort((a, b) => a.name.localeCompare(b.name)),
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

// The server builds URLs from APP_HOST, which it cannot know is reachable from
// wherever the dashboard is being viewed. Keep its scheme and port, but point
// the link at the host currently in the address bar — if you opened the
// dashboard at server.local, its services live on server.local too.
function linkForBrowser(serviceUrl) {
  try {
    const url = new URL(serviceUrl, window.location.href);
    url.hostname = window.location.hostname;
    return url.toString();
  } catch {
    return serviceUrl;
  }
}

function ServiceTile({ service, style, dragging, onPointerDown, onClickCapture }) {
  const meta = STATUS_META[service.status] || STATUS_META.unknown;
  const offline = service.status === 'offline';
  const href = linkForBrowser(service.url);
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

function TodoTile({ count, style, onClick, dragging, onPointerDown, onClickCapture }) {
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

function TodoModal({ todos, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    // Remember what had focus so it can be restored when the dialog closes.
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog.
      const focusable = dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
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
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-modal-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title" id="todo-modal-title">TODO / FIXME · {todos.length}</span>
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

const TILE = 88;            // tile diameter
const GAP = 16;             // shortest edge-to-edge gap between two tiles
const STEP = TILE + GAP;    // centre-to-centre spacing between neighbours
const ROW_STEP = (STEP * Math.sqrt(3)) / 2; // hex row height
const TARGET_ASPECT = 1.3;  // cluster shape to aim for: slightly wider than tall

const DRAG_THRESHOLD = 5;   // px of movement before a press becomes a drag
const TOUCH_HOLD_MS = 220;  // press-and-hold before a touch drag starts
const DRAG_SCALE = 1.12;    // how much the tile in hand lifts off the mosaic

// Tiles sit on a triangular lattice: x = u * STEP / 2, y = v * ROW_STEP, where u
// and v always share their parity. Every cell then has exactly six neighbours,
// all of them STEP away, which is what makes the mosaic a honeycomb.
const NEIGHBOURS = [[2, 0], [-2, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const cellId = (u, v) => `${u},${v}`;
const cellX = (u) => (u * STEP) / 2;
const cellY = (v) => v * ROW_STEP;
const parityOf = (n) => ((n % 2) + 2) % 2;

// The lattice cell nearest to a point. Only the rows either side of it can hold
// the nearest cell, and inside a row the parity fixes which column is closest.
function nearestCell(x, y) {
  const row = Math.floor(y / ROW_STEP);
  let best = [0, 0];
  let bestDist = Infinity;
  for (let v = row - 1; v <= row + 2; v += 1) {
    const parity = parityOf(v);
    const u = Math.round((x / (STEP / 2) - parity) / 2) * 2 + parity;
    const dist = Math.hypot(cellX(u) - x, cellY(v) - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = [u, v];
    }
  }
  return best;
}

// Drag-to-rearrange. Dragging a tile onto another one trades their cells;
// dragging it onto a free cell that touches the mosaic moves it there and
// leaves a hole behind. A cell with no neighbour is refused — tiles have to
// stay part of the honeycomb — and so is a drop back where the drag started.
// The tile in hand is positioned from the pointer; the rest animate across via
// the CSS transition on transform.
function useTileReorder({ mosaicRef, tiles, positions, size, arrangement, origin, setDrag, setCells }) {
  // Where the tile in hand sits. Kept in CSS variables rather than state so that
  // following the pointer costs one style write instead of a React render.
  const moveTo = useCallback((x, y) => {
    const el = mosaicRef.current;
    if (!el) return;
    el.style.setProperty('--drag-x', `${x}px`);
    el.style.setProperty('--drag-y', `${y}px`);
  }, [mosaicRef]);

  // Handlers live outside React's render flow, so they read the layout through
  // a ref that is refreshed after every render.
  const live = useRef({ tiles, positions, size, arrangement, origin });
  useEffect(() => {
    live.current = { tiles, positions, size, arrangement, origin };
  });

  const session = useRef(null); // the press in progress, if any
  const unlisten = useRef(null);
  const clickGuard = useRef(false);

  // A drag ends with a pointerup, which the browser follows with a click on the
  // tile — swallow that one click so rearranging never opens the service.
  const onTileClickCapture = useCallback((e) => {
    if (!clickGuard.current) return;
    clickGuard.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const endSession = useCallback((commit) => {
    const s = session.current;
    session.current = null;
    unlisten.current?.();
    unlisten.current = null;
    if (!s) return;
    clearTimeout(s.holdTimer);
    if (s.active) {
      clickGuard.current = true;
      setTimeout(() => {
        clickGuard.current = false; // no click followed (drag ended off-tile)
      }, 300);
      if (!commit && s.applied !== s.base) setCells(s.base); // cancelled: undo
      // A drag that changed nothing leaves the mosaic automatic; the first one
      // that does stick pins down every tile, this one included.
      if (commit && s.applied !== s.base) saveCells(s.applied);
      setDrag(null);
    }
  }, [setCells, setDrag]);

  const onPointerMove = useCallback((e) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    if (!s.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // A finger that moves before the hold elapses is scrolling the page.
      if (s.isTouch) {
        endSession(false);
        return;
      }
      s.active = true;
      setDrag({ key: s.key, origin: s.origin }); // moveTo below runs first
    }

    const x = s.originX + dx;
    const y = s.originY + dy;
    moveTo(x, y);

    // Snap by where the tile itself sits, not by the pointer: positions and
    // cells are both top-left corners, and the origin — held still for the
    // duration of the drag, so the cell under the tile doesn't drift while the
    // mosaic re-centres itself around the change — converts between them.
    const [u, v] = nearestCell(x + s.origin.x, y + s.origin.y);
    const id = cellId(u, v);
    if (id === s.appliedId) return; // still over the same cell
    s.appliedId = id;

    // Every candidate is judged against the arrangement as it was before the
    // drag, so crossing the mosaic on the way leaves no trail behind.
    const occupant = s.byCell.get(id);
    let next = s.base;
    if (occupant) {
      next = { ...s.base, [s.key]: [u, v], [occupant]: s.base[s.key] };
    } else if (id !== s.homeId && NEIGHBOURS.some(([du, dv]) => s.byCell.has(cellId(u + du, v + dv)))) {
      next = { ...s.base, [s.key]: [u, v] };
    }
    if (next === s.applied) return;
    s.applied = next;
    setCells(next);
  }, [endSession, moveTo, setCells, setDrag]);

  const onTilePointerDown = useCallback((e, key) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // left button only
    if (session.current) endSession(false);

    const { tiles: T, positions: P, arrangement: A, origin: O } = live.current;
    const slot = P[T.findIndex((t) => t.key === key)];
    const home = A.get(key);
    if (!slot || !home || !O) return;

    // Snapshot the whole mosaic: a hand-placed tile only makes sense next to
    // tiles that stay put, so the drop pins down every cell, not just this one.
    const base = {};
    const byCell = new Map();
    for (const tile of T) {
      const cell = A.get(tile.key);
      if (!cell) continue;
      base[tile.key] = cell;
      if (tile.key !== key) byCell.set(cellId(cell[0], cell[1]), tile.key);
    }

    const s = {
      key,
      pointerId: e.pointerId,
      isTouch: e.pointerType === 'touch',
      startX: e.clientX,
      startY: e.clientY,
      originX: slot.x,
      originY: slot.y,
      origin: O,
      base,
      byCell,
      homeId: cellId(home[0], home[1]),
      appliedId: cellId(home[0], home[1]),
      applied: base,
      active: false,
      holdTimer: null,
    };
    session.current = s;

    // Capture so the tile keeps receiving moves even when the pointer outruns it.
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation; window listeners cover the rest */
    }

    const onUp = (ev) => {
      if (ev.pointerId === s.pointerId) endSession(true);
    };
    const onCancel = (ev) => {
      if (ev.pointerId === s.pointerId) endSession(false);
    };
    // Once a touch drag is live the page must not scroll under it.
    const blockScroll = (ev) => {
      if (s.active) ev.preventDefault();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', blockScroll, { passive: false });
    unlisten.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', blockScroll);
      try {
        el.releasePointerCapture(s.pointerId);
      } catch {
        /* already released with the pointer */
      }
    };

    if (s.isTouch) {
      s.holdTimer = setTimeout(() => {
        s.active = true;
        moveTo(s.originX, s.originY);
        setDrag({ key: s.key, origin: s.origin });
      }, TOUCH_HOLD_MS);
    }
  }, [endSession, moveTo, onPointerMove, setDrag]);

  useEffect(() => () => {
    clearTimeout(session.current?.holdTimer);
    unlisten.current?.();
  }, []);

  return { onTilePointerDown, onTileClickCapture };
}

// Place the tiles on the honeycomb and turn that into pixels, recomputed on
// resize. `placed` holds the cells the user has arranged by hand, if any.
function useHoneycomb(tiles, placed, frozenOrigin) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => setWidth(el.getBoundingClientRect().width);
    // Measure straight away: the whole mosaic is positioned from this width, so
    // waiting for a ResizeObserver callback that may never arrive (throttled or
    // backgrounded tabs) would leave the dashboard blank.
    measure();

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const arrangement = useMemo(
    () => arrange(tiles, placed, Math.max(1, Math.floor((width + GAP) / STEP))),
    [tiles, placed, width],
  );

  return useMemo(
    () => ({ ref, arrangement, ...computeLayout(tiles, arrangement, width, frozenOrigin) }),
    [tiles, arrangement, width, frozenOrigin],
  );
}

// Which cell every tile sits in: hand-placed tiles keep theirs, and whatever is
// left is packed into the default cluster — or tucked in beside the mosaic, if
// one has already been arranged.
function arrange(tiles, placed, maxCols) {
  const cells = new Map();
  const taken = new Set();
  const put = (key, cell) => {
    cells.set(key, cell);
    taken.add(cellId(cell[0], cell[1]));
  };

  for (const tile of tiles) {
    const cell = placed[tile.key];
    if (cell && !taken.has(cellId(cell[0], cell[1]))) put(tile.key, cell);
  }

  const rest = tiles.filter((tile) => !cells.has(tile.key));
  if (rest.length === 0) return cells;
  if (cells.size === 0) {
    packCells(rest.length, maxCols).forEach((cell, i) => put(rest[i].key, cell));
    return cells;
  }
  // A service discovered after the mosaic was arranged by hand: give it the
  // free cell closest to the middle of the cluster.
  for (const tile of rest) put(tile.key, freeCellNear(cells, taken));
  return cells;
}

function freeCellNear(cells, taken) {
  const occupied = [...cells.values()];
  const midX = occupied.reduce((sum, [u]) => sum + cellX(u), 0) / occupied.length;
  const midY = occupied.reduce((sum, [, v]) => sum + cellY(v), 0) / occupied.length;
  let best = [0, 0];
  let bestDist = Infinity;
  for (const [u, v] of occupied) {
    for (const [du, dv] of NEIGHBOURS) {
      const cell = [u + du, v + dv];
      if (taken.has(cellId(cell[0], cell[1]))) continue;
      const dist = Math.hypot(cellX(cell[0]) - midX, cellY(cell[1]) - midY);
      if (dist < bestDist) {
        bestDist = dist;
        best = cell;
      }
    }
  }
  return best;
}

function computeLayout(tiles, arrangement, width, frozenOrigin) {
  if (!width || tiles.length === 0) return { positions: [], height: 0, size: TILE, origin: null };

  const xs = tiles.map((tile) => cellX(arrangement.get(tile.key)[0]));
  const ys = tiles.map((tile) => cellY(arrangement.get(tile.key)[1]));
  const clusterW = Math.max(...xs) - Math.min(...xs) + TILE;
  // The cluster is centred as a whole. During a drag the offset is frozen, so
  // that reaching for a cell doesn't shift the mosaic out from under the
  // pointer as it makes room; dropping re-centres it with the usual animation.
  const origin = frozenOrigin || {
    x: Math.min(...xs) - Math.max(0, (width - clusterW) / 2),
    y: Math.min(...ys),
  };

  const positions = xs.map((x, i) => ({ x: x - origin.x, y: ys[i] - origin.y }));
  return {
    positions,
    height: Math.max(...positions.map((p) => p.y)) + TILE,
    size: TILE,
    origin,
  };
}

// The default cluster: centred rows, each short row nested into the notches of
// the one above.
function packCells(count, maxCols) {
  const rows = rowsFor(count, bestCols(count, Math.min(maxCols, count)));
  const cells = [];
  rows.forEach((n, v) => {
    // A row of n tiles centred on the lattice starts at -(n - 1); when that
    // clashes with the row's parity, half a step over is the nearest cell, and
    // it nests the row into the one above instead of lining the two up.
    let start = -(n - 1);
    if (parityOf(start) !== parityOf(v)) start += 1;
    for (let i = 0; i < n; i += 1) cells.push([start + 2 * i, v]);
  });
  return cells;
}

// Rows alternate between `cols` and `cols - 1` tiles: the short row drops into
// the notches of the long one, which is what makes the cluster read as a
// honeycomb rather than a grid.
function rowsFor(count, cols) {
  const rows = [];
  for (let left = count, row = 0; left > 0; row += 1) {
    const n = Math.min(left, row % 2 === 0 ? cols : Math.max(1, cols - 1));
    rows.push(n);
    left -= n;
  }
  // Whatever is left over lands in the last row, and a stub of one or two tiles
  // under a full row is exactly what makes a mosaic look unfinished. Even the
  // last two rows out instead, so the cluster tapers rather than trails off.
  const last = rows.length - 1;
  if (last > 0 && rows[last] < rows[last - 1] - 1) {
    const total = rows[last] + rows[last - 1];
    rows[last - 1] = Math.ceil(total / 2);
    rows[last] = total - rows[last - 1];
  }
  return rows;
}

// How wide the rows should be. Any count can be packed many ways; score them
// all and take the tidiest, which is what stops the mosaic from looking
// lopsided at counts that don't fill their last row.
function bestCols(count, maxCols) {
  let best = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const rows = rowsFor(count, cols);
    const aspect = (Math.max(...rows) * STEP - GAP) / ((rows.length - 1) * ROW_STEP + TILE);
    // Aim for a cluster a touch wider than tall: that sits best on a screen.
    let score = Math.abs(Math.log(aspect / TARGET_ASPECT));
    // Rows of equal length sit half a step off-centre from each other rather
    // than nesting; tidy enough, but the nesting is tidier.
    for (let i = 1; i < rows.length; i += 1) {
      if ((rows[i - 1] - rows[i]) % 2 === 0) score += 0.15;
    }
    if (score < bestScore) {
      bestScore = score;
      best = cols;
    }
  }
  return best;
}
