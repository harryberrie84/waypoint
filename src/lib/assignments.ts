// ---------------------------------------------------------------------------
// Assignments, pure derive over the in-memory store for "assigned to you".
// ---------------------------------------------------------------------------
// Scans every table's `person` columns for cells that include the current user
// and surfaces one entry per (row, person column). Mirrors reminders.ts so the
// bell can fold it into the unread badge with the same localStorage-timestamp
// "seen" trick.
//
// Limitation (accepted for v1): the `key` includes `row.updated`, so any edit to
// a row you're assigned to re-surfaces it. A precise "newly assigned" signal
// would mean diffing the person cell across realtime echoes, not worth it yet.

import type { TableData, TableRow } from '../types';
import { titleColumn, cellText, isRowDone } from './tableQuery';

export interface Assignment {
  key: string; // `${rowId}:${columnId}:${row.updated}`, changes when the row is touched
  tableId: string;
  rowId: string;
  columnId: string;
  fieldName: string; // the person column's name
  title: string; // the row's title-column text
  updated: number; // row.updated as epoch ms, for the unread comparison
}

export function assignedToMe(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  userId: string,
): Assignment[] {
  if (!userId) return [];
  const out: Assignment[] = [];
  for (const row of Object.values(rows)) {
    const table = tables[row.table];
    if (!table) continue;
    const personCols = table.columns.filter((c) => c.type === 'person');
    if (!personCols.length) continue;
    if (isRowDone(table, row)) continue; // don't nag about finished work

    const tCol = titleColumn(table.columns);
    const title = (tCol ? cellText(row.cells[tCol.id] ?? null, tCol) : '') || 'Untitled';
    const updated = new Date(row.updated).getTime() || 0;

    for (const col of personCols) {
      const cell = row.cells[col.id];
      if (!Array.isArray(cell) || !cell.includes(userId)) continue;
      out.push({
        key: `${row.id}:${col.id}:${row.updated}`,
        tableId: table.id,
        rowId: row.id,
        columnId: col.id,
        fieldName: col.name,
        title,
        updated,
      });
    }
  }
  out.sort((a, b) => b.updated - a.updated); // most recently touched first
  return out;
}
