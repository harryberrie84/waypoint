import type { TableData, TableRow } from '../types';
import { titleColumn, cellText } from './tableQuery';

// ---------------------------------------------------------------------------
// Backlinks, "which rows point a relation at this one". A relation is stored
// one-directional (an id array on the source row) but means something both ways:
// the NPC links its faction, and the faction wants to know its members. This is
// a scan over every row's relation cells for the target id, grouped by source
// table, the same shape as assignments.ts/reminders.ts, no schema change. For a
// campaign-sized dataset a scan per open row is fine; cache if it ever isn't.

export interface BacklinkRef {
  rowId: string;
  title: string;
  columnName: string; // the relation column that points here
}

export interface BacklinkGroup {
  tableId: string;
  tableName: string;
  refs: BacklinkRef[];
}

export function backlinksFor(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  targetRowId: string,
): BacklinkGroup[] {
  if (!targetRowId) return [];
  const byTable = new Map<string, BacklinkGroup>();

  for (const row of Object.values(rows)) {
    if (row.id === targetRowId) continue; // a row linking itself isn't a backlink
    const table = tables[row.table];
    if (!table) continue;
    const relCols = table.columns.filter((c) => c.type === 'relation');
    if (!relCols.length) continue;

    for (const col of relCols) {
      const cell = row.cells[col.id];
      if (!Array.isArray(cell) || !cell.includes(targetRowId)) continue;

      let group = byTable.get(table.id);
      if (!group) {
        group = { tableId: table.id, tableName: table.name || 'Untitled', refs: [] };
        byTable.set(table.id, group);
      }
      // Dedupe: a row that points here through two relation columns lists once,
      // keeping the first column's name.
      if (group.refs.some((r) => r.rowId === row.id)) continue;
      const tCol = titleColumn(table.columns);
      const title = (tCol ? cellText(row.cells[tCol.id] ?? null, tCol) : '') || 'Untitled';
      group.refs.push({ rowId: row.id, title, columnName: col.name });
    }
  }

  return [...byTable.values()].sort((a, b) => a.tableName.localeCompare(b.tableName));
}
