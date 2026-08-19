// Honeycomb geometry: the triangular lattice the tiles sit on, and the packing
// that turns a tile count into a tidy centred cluster. Pure functions — no React
// and no DOM — so they can be reasoned about (and tested) in isolation.

export const TILE = 88;            // tile diameter
export const GAP = 16;             // shortest edge-to-edge gap between two tiles
export const STEP = TILE + GAP;    // centre-to-centre spacing between neighbours
export const ROW_STEP = (STEP * Math.sqrt(3)) / 2; // hex row height
export const TARGET_ASPECT = 1.3;  // cluster shape to aim for: slightly wider than tall

export const DRAG_THRESHOLD = 5;   // px of movement before a press becomes a drag
export const TOUCH_HOLD_MS = 220;  // press-and-hold before a touch drag starts
export const DRAG_SCALE = 1.12;    // how much the tile in hand lifts off the mosaic

// Tiles sit on a triangular lattice: x = u * STEP / 2, y = v * ROW_STEP, where u
// and v always share their parity. Every cell then has exactly six neighbours,
// all of them STEP away, which is what makes the mosaic a honeycomb.
export const NEIGHBOURS = [[2, 0], [-2, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const cellId = (u, v) => `${u},${v}`;
export const cellX = (u) => (u * STEP) / 2;
export const cellY = (v) => v * ROW_STEP;
const parityOf = (n) => ((n % 2) + 2) % 2;

// The lattice cell nearest to a point. Only the rows either side of it can hold
// the nearest cell, and inside a row the parity fixes which column is closest.
export function nearestCell(x, y) {
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

// Which cell every tile sits in: hand-placed tiles keep theirs, and whatever is
// left is packed into the default cluster — or tucked in beside the mosaic, if
// one has already been arranged.
export function arrange(tiles, placed, maxCols) {
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

export function computeLayout(tiles, arrangement, width, frozenOrigin) {
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
