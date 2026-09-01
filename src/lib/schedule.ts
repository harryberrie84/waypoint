// ---------------------------------------------------------------------------
// schedule, pure layout maths for the day-schedule (time-of-day) view.
// ---------------------------------------------------------------------------
// Parses datetime cells, lays overlapping events into side-by-side columns the
// way a calendar app does, and reports clashes (two things booked at once). No
// React, no store, just times in, geometry out.

export interface SEvent {
  rowId: string;
  label: string;
  startMin: number; // minutes from midnight
  endMin: number; // exclusive; callers give a default duration so nothing is zero-height
}

export interface PlacedEvent extends SEvent {
  col: number; // 0-based column within its overlap cluster
  cols: number; // total columns the cluster needs (event width = 1/cols)
}

/** Parse an ISO date or datetime-local value into a day + minutes-of-day. */
export function parseDateTime(value: unknown): { dayIso: string; minutes: number; hasTime: boolean } | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  const hasTime = m[2] !== undefined;
  const minutes = hasTime ? Number(m[2]) * 60 + Number(m[3]) : 0;
  return { dayIso: m[1], minutes, hasTime };
}

export function overlaps(a: SEvent, b: SEvent): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * Greedy column packing. Events are grouped into clusters of transitively
 * overlapping items; within a cluster each event takes the first column free at
 * its start time, and every event in the cluster is told how many columns the
 * cluster ended up needing so widths divide evenly.
 */
export function layoutDay(events: SEvent[]): PlacedEvent[] {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: PlacedEvent[] = [];
  let cluster: PlacedEvent[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = []; // last endMin per column in the current cluster

  const closeCluster = () => {
    const cols = colEnds.length || 1;
    for (const e of cluster) e.cols = cols;
    cluster = [];
    colEnds = [];
    clusterEnd = -1;
  };

  for (const e of sorted) {
    if (clusterEnd !== -1 && e.startMin >= clusterEnd) closeCluster();
    let col = colEnds.findIndex((end) => end <= e.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(e.endMin);
    } else {
      colEnds[col] = e.endMin;
    }
    const pe: PlacedEvent = { ...e, col, cols: 1 };
    cluster.push(pe);
    placed.push(pe);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  closeCluster();
  return placed;
}

/** Pairs of events that overlap in time, i.e. double-bookings on this day. */
export function clashes(events: SEvent[]): [SEvent, SEvent][] {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin);
  const out: [SEvent, SEvent][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].startMin >= sorted[i].endMin) break;
      if (overlaps(sorted[i], sorted[j])) out.push([sorted[i], sorted[j]]);
    }
  }
  return out;
}

export function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Sorted unique day list (YYYY-MM-DD) across all rows for the start column. */
export function daysWithEvents(values: unknown[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const p = parseDateTime(v);
    if (p) set.add(p.dayIso);
  }
  return [...set].sort();
}
