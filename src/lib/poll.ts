import type { TableRow } from '../types';

// ---------------------------------------------------------------------------
// poll, pure tally for table-backed polls. Each option is a row; a vote is read
// off the row by `voteOf` (the block passes a reactions-count reader), so this
// stays free of how votes are stored. No React, no store.
// ---------------------------------------------------------------------------

export interface TallyEntry {
  rowId: string;
  count: number;
  pct: number; // share of total votes, 0 when nobody has voted
}

// Votes per option, most-voted first. `pct` is against total votes cast (not
// voters), so it sums to ~100 once anyone votes and is 0 across the board when
// no one has. Ties keep input order (stable sort).
export function tally(rows: TableRow[], voteOf: (row: TableRow) => number): TallyEntry[] {
  const counts = rows.map((r) => ({ rowId: r.id, count: Math.max(0, voteOf(r)) }));
  const total = counts.reduce((n, c) => n + c.count, 0);
  return counts
    .map((c) => ({ ...c, pct: total > 0 ? (c.count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
}

// The leading option's row id, or null when empty or tied for the lead (no clear
// winner). A single option with votes wins; zero votes everywhere is no winner.
export function winner(entries: TallyEntry[]): string | null {
  if (entries.length === 0) return null;
  const top = entries[0];
  if (top.count === 0) return null;
  if (entries.length > 1 && entries[1].count === top.count) return null; // tie
  return top.rowId;
}
