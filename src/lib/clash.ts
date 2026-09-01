// Find rows whose date span overlaps another's, for the "no clashing dates" check
// (visitors on non-overlapping stays). A start date column, and an optional end
// column for a span; a missing end is a single day. Inclusive overlap. Pure.

import type { TableRow } from '../types';
import { parseInstant } from './reminders';

export function findClashes(rows: TableRow[], startCol: string, endCol?: string): Set<string> {
  if (!startCol) return new Set();
  const ranges = rows
    .map((r) => {
      const s = parseInstant(r.cells[startCol]);
      if (s == null) return null;
      const eRaw = endCol ? parseInstant(r.cells[endCol]) : null;
      const e = eRaw == null ? s : Math.max(s, eRaw);
      return { id: r.id, s, e };
    })
    .filter((x): x is { id: string; s: number; e: number } => x != null);

  const clash = new Set<string>();
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i];
      const b = ranges[j];
      if (a.s <= b.e && b.s <= a.e) {
        clash.add(a.id);
        clash.add(b.id);
      }
    }
  }
  return clash;
}
