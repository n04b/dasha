import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GAP, STEP, arrange, computeLayout } from './honeycomb.js';

// Place the tiles on the honeycomb and turn that into pixels, recomputed on
// resize. `placed` holds the cells the user has arranged by hand, if any.
export function useHoneycomb(tiles, placed, frozenOrigin) {
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
