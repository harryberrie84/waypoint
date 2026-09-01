// ---------------------------------------------------------------------------
// sharedTable, bake a table + its open view into a SELF-CONTAINED model the
// public share can render for every view type (grid/board/gallery/calendar/
// timeline/schedule/map/route) without the signed-in store. Cell display strings
// and the fields each view needs (dates, group, place) are computed at publish
// time; the shared node just lays them out. Pure, so the baker is unit-tested.
// ---------------------------------------------------------------------------

import type { Column, TableRow } from '../types';
import { geoOf, type ViewConfig, type ViewType } from './tableQuery';

export interface SharedRow {
  title: string;
  cells: string[]; // display strings aligned to `columns`
  date?: string; // yyyy-mm-dd (calendar/timeline start)
  endDate?: string; // yyyy-mm-dd (calendar/timeline end)
  start?: string; // datetime (schedule start)
  end?: string; // datetime (schedule end)
  groupKeys?: string[]; // board: which group column(s) this row sits in
  color?: string;
  lat?: number;
  lon?: number;
  place?: string;
}
export interface SharedGroup {
  key: string;
  label: string;
  color?: string;
}
export interface SharedModel {
  title: string;
  viewType: ViewType;
  columns: string[]; // header names
  rows: SharedRow[];
  groups?: SharedGroup[]; // board columns, in order
}

export function bakeSharedTable(
  columns: Column[],
  rows: TableRow[],
  view: ViewConfig,
  title: string,
  display: (row: TableRow, col: Column) => string,
  memberName: (id: string) => string,
): SharedModel {
  const groupCol = view.groupColumnId ? columns.find((c) => c.id === view.groupColumnId && (c.type === 'select' || c.type === 'person')) : undefined;
  const placeCol = view.placeColumnId ? columns.find((c) => c.id === view.placeColumnId && c.type === 'place') : undefined;
  const iso = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

  const outRows: SharedRow[] = rows.map((r) => {
    const cells = columns.map((c) => display(r, c));
    const row: SharedRow = { title: cells[0] || 'Untitled', cells };
    const d = view.dateColumnId && iso(r.cells[view.dateColumnId]);
    if (d) row.date = d.slice(0, 10);
    const ed = view.endDateColumnId && iso(r.cells[view.endDateColumnId]);
    if (ed) row.endDate = ed.slice(0, 10);
    const st = view.startTimeColumnId && iso(r.cells[view.startTimeColumnId]);
    if (st) row.start = st;
    const en = view.endTimeColumnId && iso(r.cells[view.endTimeColumnId]);
    if (en) row.end = en;
    if (groupCol) {
      if (groupCol.type === 'select') {
        const v = r.cells[groupCol.id];
        const key = typeof v === 'string' ? v : '';
        row.groupKeys = [key];
        const opt = groupCol.options?.find((o) => o.id === key);
        if (opt?.color) row.color = opt.color;
      } else {
        const ids = Array.isArray(r.cells[groupCol.id]) ? (r.cells[groupCol.id] as unknown[]).filter((x): x is string => typeof x === 'string' && x !== '') : [];
        row.groupKeys = ids.length ? ids : [''];
      }
    }
    if (placeCol) {
      const g = geoOf(r.cells[placeCol.id] ?? null);
      if (g) {
        row.lat = g.lat;
        row.lon = g.lon;
        row.place = g.name;
      }
    }
    return row;
  });

  let groups: SharedGroup[] | undefined;
  if (groupCol) {
    if (groupCol.type === 'select') {
      groups = [...(groupCol.options ?? []).map((o) => ({ key: o.id, label: o.label, color: o.color })), { key: '', label: 'No ' + groupCol.name }];
    } else {
      const seen = new Set<string>();
      const g: SharedGroup[] = [];
      for (const r of outRows) for (const k of r.groupKeys ?? []) if (k && !seen.has(k)) { seen.add(k); g.push({ key: k, label: memberName(k) }); }
      g.push({ key: '', label: 'Unassigned' });
      groups = g;
    }
  }

  return { title, viewType: view.type, columns: columns.map((c) => c.name || 'Untitled'), rows: outRows, groups };
}

// Weeks of a month as yyyy-mm-dd strings (Monday-first), null for padding cells.
// For the shared calendar's month grid. `month` is 0-indexed.
export function monthMatrix(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Day index (days since epoch) for a yyyy-mm-dd string, for timeline math.
export function dayIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
