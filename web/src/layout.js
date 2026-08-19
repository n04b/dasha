// The mosaic layout is a per-browser preference: the services themselves come
// from the compose files, and the server has nothing to persist a layout in.
// It lives in localStorage, keyed so an older order survives a format bump.

const LAYOUT_KEY = 'dasha.tile-layout.v2';
// Superseded by the layout above, but still read once so that a mosaic arranged
// before free placement existed keeps the order it was given.
const ORDER_KEY = 'dasha.tile-order.v1';

// { [tile key]: [u, v] } — the honeycomb cell each hand-placed tile occupies.
export function loadCells() {
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

export function saveCells(cells) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(cells));
  } catch {
    /* private mode / quota — the layout simply won't survive a reload */
  }
}

export function loadOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}
