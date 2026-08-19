import { useCallback, useEffect, useRef } from 'react';
import { DRAG_THRESHOLD, TOUCH_HOLD_MS, NEIGHBOURS, cellId, nearestCell } from './honeycomb.js';
import { saveCells } from './layout.js';

// Drag-to-rearrange. Dragging a tile onto another one trades their cells;
// dragging it onto a free cell that touches the mosaic moves it there and
// leaves a hole behind. A cell with no neighbour is refused — tiles have to
// stay part of the honeycomb — and so is a drop back where the drag started.
// The tile in hand is positioned from the pointer; the rest animate across via
// the CSS transition on transform.
export function useTileReorder({ mosaicRef, tiles, positions, size, arrangement, origin, setDrag, setCells }) {
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
