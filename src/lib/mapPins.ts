// Deriving a page map's place pins from table data, kept pure and dependency-free
// (beyond geoOf/extractTableIds) so it can be unit-tested and so the same logic
// serves both same-page embedded tables and tables linked in from other pages.
//
// A page map pins two kinds of table: the ones embedded in the page's own body
// (default blue, unchanged behaviour) and the ones the user has linked as
// `sources` from anywhere in the workspace, each drawn in its source colour. The
// pins re-derive from the store on every change, so editing a place on one page
// updates every map that shows that table. Pin ids stay `place:<rowId>:<colId>`
// so routes and the rename-writeback keep working across pages.

import type { CellValue, Column, GeoValue, Page, PageMapPin, PageMapSource, TableData, TableRow } from '../types';
import { geoOf } from './tableQuery';
import { extractTableIds } from './doc';

// A palette of distinct, legible pin colours for linked sources. New sources
// take the first colour not already in use, wrapping once the palette is spent.
export const SOURCE_COLORS = [
  '#e05a86', // clay pink
  '#2f7dd1', // blue
  '#34d399', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ef4444', // red
  '#0ea5e9', // sky
  '#ec4899', // magenta
  '#14b8a6', // teal
  '#a16207', // brown
];

/** The next palette colour not among `used`, wrapping to the start when they're
 *  all taken. Deterministic (no randomness), so it's testable and resume-safe. */
export function nextSourceColor(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  for (const c of SOURCE_COLORS) if (!taken.has(c.toLowerCase())) return c;
  return SOURCE_COLORS[used.length % SOURCE_COLORS.length];
}

// Rows of one table, ordered the way the map wants them: by a date/datetime
// column when the table has one (so auto-route follows the itinerary), else by
// row position. Mirrors the original in-component ordering.
function orderedRows(table: TableData, rows: Record<string, TableRow>): TableRow[] {
  const dateCol = table.columns.find((c) => c.type === 'date' || c.type === 'datetime');
  return Object.values(rows)
    .filter((r) => r.table === table.id)
    .sort((a, b) => {
      if (dateCol) {
        const av = String(a.cells[dateCol.id] ?? '');
        const bv = String(b.cells[dateCol.id] ?? '');
        if (av && bv && av !== bv) return av.localeCompare(bv);
        if (av && !bv) return -1;
        if (bv && !av) return 1;
      }
      return a.position - b.position;
    });
}

// Every place pin one table contributes, in row order, optionally coloured.
function pinsForTable(table: TableData, rows: Record<string, TableRow>, color?: string): PageMapPin[] {
  const placeCols = table.columns.filter((c) => c.type === 'place');
  if (!placeCols.length) return [];
  const out: PageMapPin[] = [];
  for (const r of orderedRows(table, rows)) {
    for (const col of placeCols) {
      const g = geoOf(r.cells[col.id] ?? null);
      if (!g) continue;
      out.push({ id: `place:${r.id}:${col.id}`, lat: g.lat, lon: g.lon, name: g.name || 'Place', kind: 'place', ...(color ? { color } : {}) });
    }
  }
  return out;
}

/**
 * All place pins a page map should show: its own embedded tables first (default
 * colour), then each linked source in its own colour. A table that is both
 * embedded and linked is drawn once, coloured (the source wins), keeping ids
 * unique so routes never see a duplicate endpoint.
 */
export function derivePlacePins(
  embeddedTableIds: string[],
  sources: PageMapSource[],
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
): PageMapPin[] {
  const sourceIds = new Set(sources.map((s) => s.tableId));
  const pins: PageMapPin[] = [];
  for (const tid of embeddedTableIds) {
    if (sourceIds.has(tid)) continue; // drawn below, in its source colour
    const t = tables[tid];
    if (t) pins.push(...pinsForTable(t, rows));
  }
  for (const s of sources) {
    const t = tables[s.tableId];
    if (t) pins.push(...pinsForTable(t, rows, s.color));
  }
  return pins;
}

/** Pull the place pins straight from a page's content (its embedded tables) plus
 *  its linked sources. Thin wrapper the component uses; the heavy lifting is the
 *  pure derivePlacePins above. */
export function derivePagePins(
  content: unknown,
  sources: PageMapSource[],
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
): PageMapPin[] {
  return derivePlacePins(extractTableIds(content), sources, tables, rows);
}

// A table that carries places, and the page it lives on, for the "add places
// from table" picker.
export interface PlaceTableRef {
  tableId: string;
  tableName: string;
  pageId: string;
  pageTitle: string;
}

/**
 * Every table with a place column reachable in one workspace, tagged with the
 * page it's embedded on, for the source picker. Deduped by table (a table
 * embedded on two pages is listed once, under the first page found), skipping
 * trashed pages and off-tree shared copies.
 */
export function placeTablesForWorkspace(
  pages: Record<string, Page>,
  tables: Record<string, TableData>,
  workspaceId: string,
): PlaceTableRef[] {
  const out: PlaceTableRef[] = [];
  const seen = new Set<string>();
  const inWs = Object.values(pages)
    .filter((p) => !p.trashed && p.parent !== '__shared__' && (p.workspace ?? '') === (workspaceId ?? ''))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  for (const p of inWs) {
    for (const tid of extractTableIds(p.content)) {
      if (seen.has(tid)) continue;
      const t = tables[tid];
      if (!t || !t.columns.some((c) => c.type === 'place')) continue;
      seen.add(tid);
      out.push({ tableId: tid, tableName: t.name || 'Untitled table', pageId: p.id, pageTitle: p.title || 'Untitled' });
    }
  }
  return out;
}

export interface AddPlaceInput {
  name: string;
  lat: number;
  lon: number;
  address?: string;
  category?: string;
}

/**
 * Build the cells for a new row that captures a place found on the map: the
 * first place column gets the geo value, and the first plain text column (the
 * row's title) gets its name. Returns null if the table has no place column to
 * write into, so the caller can skip it. Keeps the address/category when OSM
 * gave them, so the saved row carries the same detail a derived pin would.
 */
export function placeRowCells(columns: Column[], place: AddPlaceInput): Record<string, CellValue> | null {
  const placeCol = columns.find((c) => c.type === 'place');
  if (!placeCol) return null;
  const geo: GeoValue = { name: place.name, lat: place.lat, lon: place.lon };
  if (place.address) geo.address = place.address;
  if (place.category) geo.category = place.category;
  const cells: Record<string, CellValue> = { [placeCol.id]: geo };
  const titleCol = columns.find((c) => c.type === 'text' && c.id !== placeCol.id);
  if (titleCol) cells[titleCol.id] = place.name;
  return cells;
}
