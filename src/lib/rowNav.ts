// Navigation for the row drawer. A view that can order its rows hands over its
// visible order as "lanes": board stages or calendar days, each an ordered
// list of row ids. Left/right cross lanes (landing at the same height, clamped
// to the shorter lane); up/down walk the lane you are in. The walk itself is
// pure so the clamp/skip rules are testable; mounted views register as sources
// (hooks/useRowNavSource) and RowDetail's arrows + header buttons ask
// navTarget for where to go.

export type NavLanes = readonly (readonly string[])[];
export type NavDir = 'left' | 'right' | 'up' | 'down';

/** The row to open next, or null when there is nowhere to go (edge of the
 *  board/calendar, or the current row is not in these lanes at all). A row can
 *  appear in several lanes (a calendar entry spanning days) or twice in one
 *  (two date fields on the same day); duplicates of the current row are
 *  stepped over so navigation never gets stuck on itself. */
export function nextNavRow(lanes: NavLanes, currentId: string, dir: NavDir): string | null {
  let laneIdx = -1;
  let itemIdx = -1;
  for (let l = 0; l < lanes.length && laneIdx < 0; l++) {
    const i = lanes[l].indexOf(currentId);
    if (i >= 0) {
      laneIdx = l;
      itemIdx = i;
    }
  }
  if (laneIdx < 0) return null;

  if (dir === 'up' || dir === 'down') {
    const step = dir === 'up' ? -1 : 1;
    const lane = lanes[laneIdx];
    for (let i = itemIdx + step; i >= 0 && i < lane.length; i += step) {
      if (lane[i] !== currentId) return lane[i];
    }
    return null;
  }

  const step = dir === 'left' ? -1 : 1;
  for (let l = laneIdx + step; l >= 0 && l < lanes.length; l += step) {
    const lane = lanes[l];
    if (lane.length === 0) continue; // empty stage/day: keep going
    const target = lane[Math.min(itemIdx, lane.length - 1)];
    if (target !== currentId) return target;
    const other = lane.find((id) => id !== currentId);
    if (other) return other;
  }
  return null;
}

// --- Source registry ---------------------------------------------------------
// The drawer is global and view-agnostic, so mounted views register a lanes
// GETTER (read fresh on each ask, never stale) plus an optional follow-up
// (the calendar sliding its month). Module state, same pattern as proseSync.

export interface NavSource {
  getLanes: () => NavLanes;
  onOpen?: (rowId: string) => void;
}

const sources = new Set<NavSource>();

/** Register a view's order while it is mounted. Returns the unregister. */
export function registerNavSource(s: NavSource): () => void {
  sources.add(s);
  return () => sources.delete(s);
}

/** Where the drawer should go from this row, asking every mounted source; null
 *  when no view on screen can place the row (opened from a grid, say). */
export function navTarget(currentId: string, dir: NavDir): { id: string; onOpen?: (rowId: string) => void } | null {
  for (const s of sources) {
    const id = nextNavRow(s.getLanes(), currentId, dir);
    if (id && id !== currentId) return { id, onOpen: s.onOpen };
  }
  return null;
}
