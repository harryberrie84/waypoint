// Countdown wall: every dated thing in the workspace as one big board, for a
// tablet on a shelf. Pure; it takes the already-collected agenda items and turns
// them into what a wall needs, which is not what a list needs.
//
// A list wants precision. A wall wants the number you can read from across the
// room, so the unit changes with the distance: hours today, days this month,
// weeks after that. Anything already past is dropped rather than shown as a
// negative, because a wall is about what is coming.

export interface WallItem {
  id: string;
  title: string;
  /** Whole days away. 0 is today, 1 tomorrow. Never negative. */
  days: number;
  /** The big number, already in its unit. */
  value: number;
  unit: 'h' | 'd' | 'w' | 'mo';
  /** Where it came from, for the small print. */
  field: string;
  ms: number;
  hasTime: boolean;
}

/** Local midnight for an epoch time, so "days away" counts calendar days and not
 *  24-hour blocks: something at 23:00 tonight is today, not tomorrow. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function daysAway(ms: number, now: number): number {
  return Math.round((startOfDay(ms) - startOfDay(now)) / 86400000);
}

/** The unit a wall should show a gap in. Reading "42 days" across a room is
 *  worse than "6 weeks", and "0 days" is worse than the hours actually left. */
export function wallUnit(ms: number, now: number): { value: number; unit: WallItem['unit'] } {
  const days = daysAway(ms, now);
  if (days <= 0) {
    const hours = Math.max(0, Math.round((ms - now) / 3600000));
    return { value: hours, unit: 'h' };
  }
  if (days <= 30) return { value: days, unit: 'd' };
  if (days <= 120) return { value: Math.round(days / 7), unit: 'w' };
  return { value: Math.round(days / 30), unit: 'mo' };
}

export interface WallSource {
  id: string;
  title: string;
  ms: number;
  field: string;
  hasTime: boolean;
}

/**
 * Build the wall: everything still ahead, soonest first, capped. Items sharing a
 * title and a day are collapsed, because a trip row with a start and an end
 * column should be one thing on a wall, not two identical tiles.
 */
export function buildWall(items: WallSource[], now: number, limit = 24): WallItem[] {
  const seen = new Set<string>();
  const out: WallItem[] = [];
  for (const item of [...items].sort((a, b) => a.ms - b.ms)) {
    if (!Number.isFinite(item.ms)) continue;
    const days = daysAway(item.ms, now);
    if (days < 0) continue; // a wall shows what is coming, not what is gone
    const key = `${item.title.trim().toLowerCase()}|${days}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { value, unit } = wallUnit(item.ms, now);
    out.push({ id: item.id, title: item.title || 'Untitled', days, value, unit, field: item.field, ms: item.ms, hasTime: item.hasTime });
    if (out.length >= limit) break;
  }
  return out;
}

/** How urgent a tile is, for its colour. Deliberately coarse: a wall is read at
 *  a glance, so three bands beat a gradient. */
export function wallTone(days: number): 'now' | 'soon' | 'later' {
  if (days <= 0) return 'now';
  if (days <= 7) return 'soon';
  return 'later';
}
