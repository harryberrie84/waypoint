import type { CellValue } from '../types';
import { isoDate } from './automations';

// ---------------------------------------------------------------------------
// recurrence, pure date math + cell-building for recurring rows. The store
// spawns the next occurrence when a "done" edit fires; this module figures out
// what that occurrence's cells should be. Kept pure (no store, no React) so it's
// fully testable; the spawn itself lives in the store (the engine can't create
// rows, and shouldn't).
// ---------------------------------------------------------------------------

export type RecurrenceUnit = 'day' | 'week' | 'month';

export interface RecurrenceInterval {
  unit: RecurrenceUnit;
  n: number;
}

export interface RecurrenceRule {
  dateColumnId: string; // the date to advance on the spawned row
  interval: RecurrenceInterval;
}

/** Advance an ISO date (`YYYY-MM-DD`) by the interval, matching isoDate's
 *  formatting. Month math clamps to the end of the target month (Jan 31 + 1mo →
 *  Feb 28/29) rather than spilling into the next month. Non-dates pass through. */
export function nextDate(iso: string, interval: RecurrenceInterval): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1; // 0-based month
  const d = Number(m[3]);
  const n = Math.max(1, Math.floor(interval.n || 1));

  if (interval.unit === 'day' || interval.unit === 'week') {
    const base = new Date(y, mo, d);
    base.setDate(base.getDate() + (interval.unit === 'week' ? n * 7 : n));
    return isoDate(base);
  }

  // month
  const targetMonth = mo + n;
  const ny = y + Math.floor(targetMonth / 12);
  const nm = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(ny, nm + 1, 0).getDate(); // day 0 of the next month = last of this
  return isoDate(new Date(ny, nm, Math.min(d, lastDay)));
}

/** The spawned row's cells: clone the previous row, advance the date column, and
 *  reset the done signal to null so the new row starts open. That reset is what
 *  prevents an infinite spawn loop (an already-"done" row would re-trigger). */
export function buildNextCells(
  prevCells: Record<string, CellValue>,
  dateColumnId: string,
  interval: RecurrenceInterval,
  doneColumnId: string,
): Record<string, CellValue> {
  const next: Record<string, CellValue> = { ...prevCells };
  const prev = next[dateColumnId];
  if (typeof prev === 'string' && prev) next[dateColumnId] = nextDate(prev, interval);
  next[doneColumnId] = null;
  return next;
}
