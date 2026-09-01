import type { Column, CellValue, TableRow, TableData, SelectOption, GeoValue, AttachmentValue, NumberFormat } from '../types';
import { cellLinkLabel } from './cellLink';

// ---------------------------------------------------------------------------
// tableQuery, pure filter / sort / group logic shared by every table view.
// No React, no store: just data in, data out, so it is trivially testable.
// ---------------------------------------------------------------------------

export type ViewType = 'grid' | 'board' | 'gallery' | 'calendar' | 'timeline' | 'map' | 'route' | 'schedule';

export type FilterOp =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'isEmpty'
  | 'notEmpty'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'before'
  | 'after'
  | 'onOrBefore'
  | 'onOrAfter'
  | 'isChecked'
  | 'isUnchecked'
  | 'includes'
  | 'excludes';

export interface Filter {
  id: string;
  columnId: string;
  op: FilterOp;
  value: CellValue;
}

// A conditional-format rule: the same column/op/value a Filter uses, plus a colour
// to tint a matching row. Evaluated in order, first match wins (see rowColor).
export interface ColorRule {
  id: string;
  columnId: string;
  op: FilterOp;
  value: CellValue;
  color: string; // a 6-digit hex from ROW_COLORS
}

// The tints offered for a colour rule. Hex so we can apply a faint fill + a solid
// left bar inline (works in both light and dark without a class per colour).
export const ROW_COLORS: { name: string; hex: string }[] = [
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Slate', hex: '#64748b' },
];

export interface SortRule {
  id: string;
  columnId: string;
  dir: 'asc' | 'desc';
}

export interface ViewConfig {
  id: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  sorts: SortRule[];
  groupColumnId?: string; // board grouping (select column)
  cardSortColumnId?: string; // board, sort the cards WITHIN each stage by this column (empty = default/query order)
  cardSortDir?: 'asc' | 'desc'; // board, direction for cardSort (default 'asc'); a select sorts by its custom option order
  dateColumnId?: string; // calendar placement, the start/"from" date
  endDateColumnId?: string; // calendar, optional end/"to" date for multi-day spans
  defaultMonth?: string; // calendar, 'YYYY-MM' the view always opens on (empty = auto)
  placeColumnId?: string; // map, which place column to pin by
  categoryColumnId?: string; // map, select column to colour/filter pins by
  arrivalColumnId?: string; // route, arrival date column
  departureColumnId?: string; // route, departure date column
  routeProfile?: 'driving' | 'walking' | 'cycling'; // route, travel mode for OSRM legs
  startTimeColumnId?: string; // schedule, start datetime column
  endTimeColumnId?: string; // schedule, optional end datetime column
  dependsOnColumnId?: string; // timeline, self-relation column holding predecessor row ids
  enforceDependencies?: boolean; // timeline, clamp a successor's start to its predecessors' ends
  colorColumnId?: string; // timeline, colour bars by a person column's assignee
  clashStartId?: string; // "no clashing dates": the start/from date column to check
  clashEndId?: string; // "no clashing dates": optional end/to date for a span
  hiddenColumns?: string[]; // per-view column hide: ids the grid/board/etc. omit (data is untouched)
  colorRules?: ColorRule[]; // conditional formatting: tint a row whose cells match a rule
}

// Which operators make sense for each column type. The grid query UI uses this
// to offer only valid ops, and labels them for humans.
export const OPS_BY_TYPE: Record<string, { op: FilterOp; label: string; noValue?: boolean }[]> = {
  text: [
    { op: 'contains', label: 'contains' },
    { op: 'notContains', label: 'does not contain' },
    { op: 'is', label: 'is' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  number: [
    { op: 'eq', label: '=' },
    { op: 'neq', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'gte', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'lte', label: '≤' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  select: [
    { op: 'is', label: 'is' },
    { op: 'isNot', label: 'is not' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  multiselect: [
    { op: 'includes', label: 'includes' },
    { op: 'excludes', label: 'excludes' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  // Person cells are `string[]` of user ids, so filtering is array-contains,
  // the same `includes`/`excludes` ops matchFilter already implements for
  // multiselect. The `@me` sentinel is resolved to a real id upstream (TableView
  // has auth); matchFilter stays pure and user-agnostic.
  person: [
    { op: 'includes', label: 'includes' },
    { op: 'excludes', label: 'excludes' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  checkbox: [
    { op: 'isChecked', label: 'is checked', noValue: true },
    { op: 'isUnchecked', label: 'is unchecked', noValue: true },
  ],
  url: [
    { op: 'contains', label: 'contains' },
    { op: 'is', label: 'is' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  place: [
    { op: 'contains', label: 'name contains' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  date: [
    { op: 'is', label: 'is' },
    { op: 'before', label: 'is before' },
    { op: 'after', label: 'is after' },
    { op: 'onOrBefore', label: 'is on or before' },
    { op: 'onOrAfter', label: 'is on or after' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  datetime: [
    { op: 'before', label: 'is before' },
    { op: 'after', label: 'is after' },
    { op: 'onOrBefore', label: 'is on or before' },
    { op: 'onOrAfter', label: 'is on or after' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  formula: [
    { op: 'eq', label: '=' },
    { op: 'gt', label: '>' },
    { op: 'lt', label: '<' },
  ],
  relation: [
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  rollup: [
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  progress: [
    { op: 'gt', label: '>' },
    { op: 'lt', label: '<' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  button: [{ op: 'notEmpty', label: '(no filters)', noValue: true }],
  attachment: [
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
  reminder: [
    { op: 'before', label: 'is before' },
    { op: 'after', label: 'is after' },
    { op: 'onOrBefore', label: 'is on or before' },
    { op: 'onOrAfter', label: 'is on or after' },
    { op: 'isEmpty', label: 'is empty', noValue: true },
    { op: 'notEmpty', label: 'is not empty', noValue: true },
  ],
};

function isEmptyValue(v: CellValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    const o = v as { lat?: number; data?: string };
    if (typeof o.data === 'string') return o.data === ''; // attachment
    return typeof o.lat !== 'number'; // geo
  }
  return false; // numbers and booleans are always concrete values
}

function toNum(v: CellValue): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Evaluate a single filter against a single cell value. */
export function matchFilter(cell: CellValue, filter: Filter): boolean {
  const { op, value } = filter;
  // For place cells, text ops compare against the place name.
  const g = geoOf(cell);
  const textCell: CellValue = g ? g.name : cell;
  switch (op) {
    case 'isEmpty':
      return isEmptyValue(cell);
    case 'notEmpty':
      return !isEmptyValue(cell);
    case 'isChecked':
      return cell === true;
    case 'isUnchecked':
      return cell !== true;
    case 'includes':
      return Array.isArray(cell) && cell.includes(value as string);
    case 'excludes':
      return !(Array.isArray(cell) && cell.includes(value as string));
    case 'is':
      return String(textCell ?? '') === String(value ?? '');
    case 'isNot':
      return String(textCell ?? '') !== String(value ?? '');
    case 'contains':
      return String(textCell ?? '')
        .toLowerCase()
        .includes(String(value ?? '').toLowerCase());
    case 'notContains':
      return !String(textCell ?? '')
        .toLowerCase()
        .includes(String(value ?? '').toLowerCase());
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNum(cell);
      const b = toNum(value);
      if (a === null || b === null) return false;
      if (op === 'eq') return a === b;
      if (op === 'neq') return a !== b;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      return a <= b;
    }
    case 'before':
    case 'after':
    case 'onOrBefore':
    case 'onOrAfter': {
      const a = typeof cell === 'string' ? cell : '';
      const b = typeof value === 'string' ? value : '';
      if (!a || !b) return false;
      if (op === 'before') return a < b;
      if (op === 'after') return a > b;
      if (op === 'onOrBefore') return a <= b;
      return a >= b;
    }
    default:
      return true;
  }
}

/** Keep rows where ALL filters pass (AND semantics, like Notion's default). */
export function filterRows(rows: TableRow[], filters: Filter[]): TableRow[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((f) => matchFilter(row.cells[f.columnId] ?? null, f)));
}

/** The tint for a row: the colour of the FIRST colour rule its cells match, or
 *  null. Reuses matchFilter, so a rule reads exactly like a filter of the same
 *  column/op/value. `@me` in a person rule must already be resolved to an id. */
export function rowColor(cells: Record<string, CellValue>, rules: ColorRule[] | undefined): string | null {
  if (!rules || rules.length === 0) return null;
  for (const r of rules) {
    if (!r.columnId || !r.color) continue;
    if (matchFilter(cells[r.columnId] ?? null, { id: r.id, columnId: r.columnId, op: r.op, value: r.value })) {
      return r.color;
    }
  }
  return null;
}

function compareNonEmpty(a: CellValue, b: CellValue, column: Column): number {
  if (column.type === 'number' || column.type === 'formula') {
    return (toNum(a) ?? 0) - (toNum(b) ?? 0);
  }
  // Select sorts by option order (P1, P2, P3…), not the random option-id string.
  if (column.type === 'select' && column.options && column.options.length) {
    const ia = column.options.findIndex((o) => o.id === a);
    const ib = column.options.findIndex((o) => o.id === b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? column.options.length : ia) - (ib === -1 ? column.options.length : ib);
    }
  }
  return String(a).localeCompare(String(b));
}

/** Apply sort rules in order; empties always sort last, then row position. */
export function sortRows(rows: TableRow[], sorts: SortRule[], columns: Column[]): TableRow[] {
  if (sorts.length === 0) return rows;
  const colOf = (id: string) => columns.find((c) => c.id === id);
  return [...rows].sort((ra, rb) => {
    for (const s of sorts) {
      const va = ra.cells[s.columnId] ?? null;
      const vb = rb.cells[s.columnId] ?? null;
      const aEmpty = isEmptyValue(va);
      const bEmpty = isEmptyValue(vb);
      if (aEmpty && bEmpty) continue;
      if (aEmpty) return 1; // empties last, not affected by direction
      if (bEmpty) return -1;
      const col = colOf(s.columnId);
      const base = col ? compareNonEmpty(va, vb, col) : String(va).localeCompare(String(vb));
      if (base !== 0) return s.dir === 'asc' ? base : -base;
    }
    return ra.position - rb.position;
  });
}

/** Filter + sort in one call. */
export function applyQuery(rows: TableRow[], columns: Column[], config: ViewConfig): TableRow[] {
  return sortRows(filterRows(rows, config.filters), config.sorts, columns);
}

export interface RowGroup {
  key: string; // option id, or '' for ungrouped
  label: string;
  color: string | null;
  rows: TableRow[];
}

/**
 * Group rows for a board. A `select` column buckets by option (in option order)
 * with a trailing "uncategorized"; a `person` column buckets by user id (one per
 * member who appears) with a trailing "Unassigned". Anything else is a single
 * "All" bucket. Person labels are ids here, the board resolves them to names,
 * so this stays roster-free and pure.
 */
export function groupRows(rows: TableRow[], column: Column | undefined): RowGroup[] {
  if (!column) return [{ key: '', label: 'All', color: null, rows }];

  if (column.type === 'person') {
    const buckets = new Map<string, RowGroup>();
    const unassigned: RowGroup = { key: '', label: 'Unassigned', color: null, rows: [] };
    for (const row of rows) {
      const raw = row.cells[column.id];
      const ids = (Array.isArray(raw) ? raw : []).filter((id): id is string => typeof id === 'string' && id !== '');
      if (ids.length === 0) {
        unassigned.rows.push(row);
        continue;
      }
      // A multi-person row appears in each assignee's column.
      for (const id of ids) {
        let bucket = buckets.get(id);
        if (!bucket) {
          bucket = { key: id, label: id, color: null, rows: [] };
          buckets.set(id, bucket);
        }
        bucket.rows.push(row);
      }
    }
    return [...buckets.values(), unassigned];
  }

  if (column.type !== 'select') {
    return [{ key: '', label: 'All', color: null, rows }];
  }
  const options: SelectOption[] = column.options ?? [];
  const buckets: RowGroup[] = options.map((o) => ({ key: o.id, label: o.label, color: o.color, rows: [] }));
  const uncategorized: RowGroup = { key: '', label: 'No ' + column.name, color: null, rows: [] };
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const row of rows) {
    const v = row.cells[column.id];
    const bucket = (typeof v === 'string' && byKey.get(v)) || uncategorized;
    bucket.rows.push(row);
  }
  return [...buckets, uncategorized];
}

// --- Column pickers (sensible defaults for views) ---------------------------

export function firstSelectColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.type === 'select');
}
export function firstDateColumn(columns: Column[]): Column | undefined {
  // Prefer a plain date, but fall back to a datetime so a table whose only
  // dated column carries a time still auto-configures the calendar/timeline.
  return columns.find((c) => c.type === 'date') ?? columns.find((c) => c.type === 'datetime');
}
export function firstDatetimeColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.type === 'datetime');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mar 14, 18:40" for a datetime-local value; drops the time if there isn't one. */
export function formatDateTime(value: CellValue): string {
  if (typeof value !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return '';
  const date = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return m[4] !== undefined ? `${date}, ${m[4]}:${m[5]}` : date;
}
/** The column to use as a card/pill title: first text column, else first column. */
export function titleColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.type === 'text') ?? columns[0];
}

/** A row's display name for calendars/agendas/cards: the title column's value,
 *  but if that's blank for this row (e.g. a CSV imported its names into a
 *  different text column than the pre-existing title column), fall back to the
 *  first OTHER text column that has a value. Returns '' if nothing is filled;
 *  callers add their own "Untitled". */
export function rowTitle(
  cells: Record<string, CellValue>,
  columns: Column[],
  members: readonly { id: string; name: string }[] = [],
): string {
  const title = titleColumn(columns);
  if (title) {
    const t = cellText(cells[title.id] ?? null, title, members).trim();
    if (t) return t;
  }
  for (const c of columns) {
    if (c.id === title?.id || c.type !== 'text') continue;
    const t = cellText(cells[c.id] ?? null, c, members).trim();
    if (t) return t;
  }
  return '';
}

// A per-row icon (emoji or image url), stored under a reserved cell key so it needs
// no schema change and stays encrypted with the rest of the cells. It is not a
// column, so it never shows in the grid as a field, exports, or formulas; views
// read it to show an icon beside the row's name.
export const ROW_ICON_KEY = '__icon__';
export function rowIcon(row: TableRow): string {
  const v = row.cells[ROW_ICON_KEY];
  return typeof v === 'string' ? v : '';
}
/** Whether a row sits in a "done" board stage: any select cell pointing at an
 *  option the user marked as done. Lets Home and the agenda drop finished work. */
export function isRowDone(table: TableData, row: TableRow): boolean {
  for (const col of table.columns) {
    if (col.type !== 'select') continue;
    const v = row.cells[col.id];
    if (typeof v !== 'string' || !v) continue;
    if (col.options?.some((o) => o.id === v && o.done)) return true;
  }
  return false;
}

/** Display a cell as plain text (resolves select option labels). A `members`
 *  roster, when passed, resolves person columns to names; without it they fall
 *  back to raw ids (lossless, never throws). Kept pure, no auth, no fetch. */
export function cellText(value: CellValue, column: Column, members: readonly { id: string; name: string }[] = []): string {
  if (column.type === 'checkbox') return value === true ? '✓' : '';
  if (column.type === 'checklist') {
    const items = Array.isArray(value) ? (value as { checked?: boolean }[]) : [];
    return items.length ? `${items.filter((i) => i && i.checked).length}/${items.length}` : '';
  }
  if (column.type === 'place') {
    const g = geoOf(value);
    return g ? g.name : '';
  }
  if (column.type === 'attachment') {
    const a = attachmentOf(value);
    return a ? a.name : '';
  }
  if (column.type === 'person') {
    const ids = Array.isArray(value) ? value : [];
    return ids.map((id) => members.find((m) => m.id === id)?.name ?? id).join(', ');
  }
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'text' || column.type === 'url') return cellLinkLabel(value);
  if (column.type === 'datetime' || column.type === 'reminder') return formatDateTime(value);
  if (column.type === 'select') {
    const opt = (column.options ?? []).find((o) => o.id === value);
    return opt ? opt.label : '';
  }
  if (column.type === 'multiselect') {
    const ids = Array.isArray(value) ? value : [];
    return ids
      .map((id) => (column.options ?? []).find((o) => o.id === id)?.label)
      .filter(Boolean)
      .join(', ');
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

// Resolve one cell of a named grid (table -> row -> column) to display text, for
// the Custom Card block. Pure and graceful: `ok` is false and `value` empty when
// any part is missing (table deleted, row/column removed), so the card can show a
// "pick a cell" / "missing" state instead of throwing. Also returns the table /
// column / row names for the card's caption.
export function resolveCellText(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  tableId: string,
  columnId: string,
  rowId: string,
  members: readonly { id: string; name: string }[] = [],
): { value: string; ok: boolean; tableName: string; columnName: string; rowName: string } {
  const table = tables[tableId];
  const row = rows[rowId];
  const col = table?.columns.find((c) => c.id === columnId);
  if (!table || !row || !col || row.table !== tableId) {
    return { value: '', ok: false, tableName: table?.name ?? '', columnName: col?.name ?? '', rowName: '' };
  }
  const titleCol = table.columns[0];
  const rowName = titleCol ? cellText(row.cells[titleCol.id] ?? null, titleCol, members) : '';
  return { value: cellText(row.cells[col.id] ?? null, col, members), ok: true, tableName: table.name, columnName: col.name, rowName };
}

// Lookup: follow a relation column on this row, then read one column off each
// related row and join the labels. Read-only and derived, degrades to '' if the
// relation or target is gone (same graceful pattern as rollup). Same traversal
// as the rollup resolver, different reducer: rollup aggregates numbers, lookup
// concatenates text.
export function resolveLookup(
  thisRow: TableRow | undefined,
  columns: Column[],
  lookupCol: Column,
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  members: readonly { id: string; name: string }[] = [],
): string {
  const relCol = columns.find((c) => c.id === lookupCol.lookupRelationColumnId && c.type === 'relation');
  if (!relCol || !relCol.relationTableId || !lookupCol.lookupTargetColumnId) return '';
  const targetTable = tables[relCol.relationTableId];
  const targetCol = targetTable?.columns.find((c) => c.id === lookupCol.lookupTargetColumnId);
  if (!targetTable || !targetCol) return '';
  const ids = Array.isArray(thisRow?.cells[relCol.id]) ? (thisRow!.cells[relCol.id] as string[]) : [];
  const parts: string[] = [];
  for (const rid of ids) {
    const r = rows[rid];
    if (!r) continue;
    const t = cellText(r.cells[targetCol.id] ?? null, targetCol, members);
    if (t) parts.push(t);
  }
  return parts.join(', ');
}

// --- View config persistence (per table, localStorage) ----------------------
// Per-browser, not synced across users, see notes. Centralized here so the
// store (when seeding a preset) and TableView read/write the exact same key.

export function viewKey(tableId: string): string {
  return `waypoint:view:${tableId}`;
}

export function defaultViewConfig(): ViewConfig {
  return { id: 'default', name: 'Grid', type: 'grid', filters: [], sorts: [] };
}

export function loadViewConfig(tableId: string): ViewConfig {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(viewKey(tableId));
      if (raw) return { ...defaultViewConfig(), ...(JSON.parse(raw) as Partial<ViewConfig>) };
    }
  } catch {
    /* ignore */
  }
  return defaultViewConfig();
}

export function saveViewConfig(tableId: string, cfg: ViewConfig): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(viewKey(tableId), JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

// --- Table presets (used by the /board, /calendar, /gallery slash commands) --
// Pure: builds the starter columns + matching view config for a preset so a
// freshly inserted database opens directly in the chosen view with something
// to show (board has a Status select, calendar has a Date column).

import { uid, pickTagColor } from './id';
import { getBaseCurrency } from './fx';

export type TablePreset =
  | ViewType
  | 'accommodation'
  | 'journal'
  | 'itinerary'
  | 'transport'
  | 'budget'
  | 'packing'
  | 'reservation'
  | 'recipe'
  | 'casebrief'
  | 'statute'
  | 'authority'
  | 'lecture'
  | 'bills'
  | 'deadlines'
  | 'meals'
  | 'groceries'
  | 'campaign'
  | 'family'
  | 'poll'
  | 'rolltable'
  | 'combat'
  | 'routine';

// The number formats that carry a currency symbol. Anything else renders plain,
// so an unlisted base shows the figure without pretending it is dollars.
function baseNumberFormat(code: string): NumberFormat {
  const known: Record<string, NumberFormat> = { SEK: 'sek', JPY: 'yen', EUR: 'eur', USD: 'usd' };
  return known[code.toUpperCase()] ?? 'plain';
}

export function buildTablePreset(preset: TablePreset): { columns: Column[]; view: ViewConfig } {
  const colName = uid('c');
  const base = (type: ViewType, extra: Partial<ViewConfig> = {}): ViewConfig => ({
    id: 'default',
    name: type[0].toUpperCase() + type.slice(1),
    type,
    filters: [],
    sorts: [],
    ...extra,
  });

  if (preset === 'itinerary') {
    const colPlace = uid('c');
    const colArrive = uid('c');
    const colDepart = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Stop', type: 'text', width: 180 },
      { id: colPlace, name: 'Place', type: 'place', width: 180 },
      { id: colArrive, name: 'Arrive', type: 'date', width: 130 },
      { id: colDepart, name: 'Depart', type: 'date', width: 130 },
    ];
    return { columns, view: base('route', { placeColumnId: colPlace, arrivalColumnId: colArrive, departureColumnId: colDepart }) };
  }

  if (preset === 'journal') {
    const colDate = uid('c');
    const colPlace = uid('c');
    const colMood = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Entry', type: 'text', width: 200 },
      { id: colDate, name: 'Date', type: 'date', width: 130 },
      { id: colPlace, name: 'Place', type: 'place', width: 170 },
      {
        id: colMood,
        name: 'Mood',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: '😍 Loved it', color: pickTagColor(6) },
          { id: uid('o'), label: '🙂 Good', color: pickTagColor(2) },
          { id: uid('o'), label: '😐 Meh', color: pickTagColor(7) },
        ],
      },
    ];
    return { columns, view: base('gallery', { placeColumnId: colPlace }) };
  }

  if (preset === 'transport') {
    const colMode = uid('c');
    const colFrom = uid('c');
    const colTo = uid('c');
    const colDepart = uid('c');
    const colArrive = uid('c');
    const colCarrier = uid('c');
    const colNumber = uid('c');
    const colSeat = uid('c');
    const colReserved = uid('c');
    const colConf = uid('c');
    const colFile = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Leg', type: 'text', width: 170 },
      {
        id: colMode,
        name: 'Mode',
        type: 'select',
        width: 110,
        options: [
          { id: uid('o'), label: '✈ Flight', color: pickTagColor(1) },
          { id: uid('o'), label: '🚄 Train', color: pickTagColor(2) },
          { id: uid('o'), label: '🚌 Bus', color: pickTagColor(3) },
          { id: uid('o'), label: '⛴ Ferry', color: pickTagColor(5) },
          { id: uid('o'), label: '🚗 Car', color: pickTagColor(7) },
        ],
      },
      { id: colFrom, name: 'From', type: 'place', width: 160 },
      { id: colTo, name: 'To', type: 'place', width: 160 },
      { id: colDepart, name: 'Depart', type: 'datetime', width: 160 },
      { id: colArrive, name: 'Arrive', type: 'datetime', width: 160 },
      { id: colCarrier, name: 'Carrier', type: 'text', width: 130 },
      { id: colNumber, name: 'Number', type: 'text', width: 100 },
      { id: colSeat, name: 'Seat', type: 'text', width: 90 },
      // Unreserved vs reserved/green-car is the thing you actually need to know
      // with a JR Pass, worth a column of its own.
      { id: colReserved, name: 'Reserved seat?', type: 'checkbox', width: 120 },
      { id: colConf, name: 'Confirmation', type: 'text', width: 150 },
      { id: colFile, name: 'File', type: 'attachment', width: 120 },
    ];
    return {
      columns,
      view: base('schedule', {
        startTimeColumnId: colDepart,
        endTimeColumnId: colArrive,
        placeColumnId: colTo,
        arrivalColumnId: colArrive,
        departureColumnId: colDepart,
        sorts: [{ id: uid('s'), columnId: colDepart, dir: 'asc' }],
      }),
    };
  }

  if (preset === 'schedule') {
    const colStart = uid('c');
    const colEnd = uid('c');
    const colLoc = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Event', type: 'text', width: 200 },
      { id: colStart, name: 'Start', type: 'datetime', width: 160 },
      { id: colEnd, name: 'End', type: 'datetime', width: 160 },
      { id: colLoc, name: 'Place', type: 'place', width: 170 },
    ];
    return {
      columns,
      view: base('schedule', {
        startTimeColumnId: colStart,
        endTimeColumnId: colEnd,
        placeColumnId: colLoc,
        sorts: [{ id: uid('s'), columnId: colStart, dir: 'asc' }],
      }),
    };
  }

  if (preset === 'accommodation') {
    // Rates are quoted in the destination's money; the extra column converts to
    // whatever the reader settles in, which is a per-install answer, not a fixed one.
    const accBase = getBaseCurrency();
    const colPlace = uid('c');
    const colIn = uid('c');
    const colOut = uid('c');
    const colNights = uid('c');
    const colRate = uid('c');
    const colTotal = uid('c');
    const colBaseTotal = uid('c');
    const colLink = uid('c');
    const colConf = uid('c');
    const colStatus = uid('c');
    const colFile = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Hotel / Airbnb', type: 'text', width: 200 },
      { id: colPlace, name: 'Place', type: 'place', width: 180 },
      { id: colIn, name: 'Check-in', type: 'date', width: 130 },
      { id: colOut, name: 'Check-out', type: 'date', width: 130 },
      { id: colNights, name: 'Nights', type: 'formula', width: 90, formula: '[Check-out] - [Check-in]' },
      { id: colRate, name: 'Rate', type: 'number', width: 110, numberFormat: 'yen' },
      { id: colTotal, name: 'Total', type: 'formula', width: 120, formula: '[Nights] * [Rate]', numberFormat: 'yen' },
      { id: colBaseTotal, name: `Total (${accBase})`, type: 'formula', width: 120, formula: `fx([Total], 'JPY', '${accBase}')`, numberFormat: baseNumberFormat(accBase) },
      { id: colLink, name: 'Booking', type: 'url', width: 150 },
      { id: colConf, name: 'Confirmation #', type: 'text', width: 140 },
      {
        id: colStatus,
        name: 'Status',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'Researching', color: pickTagColor(3) },
          { id: uid('o'), label: 'Booked', color: pickTagColor(1) },
          { id: uid('o'), label: 'Paid', color: pickTagColor(2) },
        ],
      },
      { id: colFile, name: 'File', type: 'attachment', width: 120 },
    ];
    return { columns, view: base('grid', { placeColumnId: colPlace }) };
  }

  if (preset === 'board') {
    const colStatus = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Name', type: 'text', width: 200 },
      {
        id: colStatus,
        name: 'Status',
        type: 'select',
        width: 140,
        options: [
          { id: uid('o'), label: 'To do', color: pickTagColor(0) },
          { id: uid('o'), label: 'In progress', color: pickTagColor(1) },
          { id: uid('o'), label: 'Done', color: pickTagColor(2) },
        ],
      },
    ];
    return { columns, view: base('board', { groupColumnId: colStatus }) };
  }

  if (preset === 'calendar' || preset === 'timeline') {
    const colStart = uid('c');
    const colEnd = uid('c');
    const colLoc = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Name', type: 'text', width: 200 },
      { id: colStart, name: 'From', type: 'date', width: 140 },
      { id: colEnd, name: 'To', type: 'date', width: 140 },
      { id: colLoc, name: 'Location', type: 'text', width: 180 },
    ];
    return { columns, view: base(preset, { dateColumnId: colStart, endDateColumnId: colEnd }) };
  }

  if (preset === 'map') {
    const colPlace = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Name', type: 'text', width: 200 },
      { id: colPlace, name: 'Place', type: 'place', width: 200 },
    ];
    return { columns, view: base('map', { placeColumnId: colPlace }) };
  }

  if (preset === 'gallery') {
    const colNotes = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Name', type: 'text', width: 200 },
      { id: colNotes, name: 'Notes', type: 'text', width: 240 },
    ];
    return { columns, view: base('gallery') };
  }

  if (preset === 'budget') {
    // Base currency is read once here and baked into the "In base" column; the
    // settlement block reads it live. One place, both readers. (Switching base
    // later re-settles the summary; this display column keeps its creation-time
    // base, fine, since the summary, not the column, is the source of truth.)
    const base$ = getBaseCurrency();
    const baseFmt = baseNumberFormat(base$);
    const colAmount = uid('c');
    const colCurrency = uid('c');
    const colBase = uid('c');
    const colPaidBy = uid('c');
    const colSplit = uid('c');
    const colCategory = uid('c');
    const colDate = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Item', type: 'text', width: 180 },
      { id: colAmount, name: 'Amount', type: 'number', width: 110 },
      {
        id: colCurrency,
        name: 'Currency',
        type: 'select',
        width: 110,
        // Labels are the ISO codes fx() reads (buildScope resolves a select to
        // its label). Open list, add others as needed; default is JPY.
        options: [
          { id: uid('o'), label: 'JPY', color: pickTagColor(1) },
          { id: uid('o'), label: 'SEK', color: pickTagColor(2) },
          { id: uid('o'), label: 'EUR', color: pickTagColor(3) },
          { id: uid('o'), label: 'USD', color: pickTagColor(5) },
        ],
      },
      // Empty currency defaults to JPY (the engine has no `=`, so use truthy via if()).
      {
        id: colBase,
        name: `In ${base$}`,
        type: 'formula',
        width: 120,
        formula: `fx([Amount], if([Currency], [Currency], 'JPY'), '${base$}')`,
        numberFormat: baseFmt,
      },
      { id: colPaidBy, name: 'Paid by', type: 'person', width: 150 },
      { id: colSplit, name: 'Split among', type: 'person', width: 180, peopleMulti: true },
      {
        id: colCategory,
        name: 'Category',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'Food', color: pickTagColor(1) },
          { id: uid('o'), label: 'Transport', color: pickTagColor(2) },
          { id: uid('o'), label: 'Lodging', color: pickTagColor(3) },
          { id: uid('o'), label: 'Activities', color: pickTagColor(5) },
          { id: uid('o'), label: 'Shopping', color: pickTagColor(6) },
          { id: uid('o'), label: 'Misc', color: pickTagColor(7) },
        ],
      },
      { id: colDate, name: 'Date', type: 'date', width: 130 },
    ];
    return { columns, view: base('grid', { sorts: [{ id: uid('s'), columnId: colDate, dir: 'asc' }] }) };
  }

  if (preset === 'recipe') {
    const colServes = uid('c');
    const colTime = uid('c');
    const colIngredients = uid('c');
    const colSteps = uid('c');
    const colTags = uid('c');
    const colMade = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Recipe', type: 'text', width: 200 },
      { id: colServes, name: 'Serves', type: 'number', width: 90 },
      { id: colTime, name: 'Time', type: 'text', width: 100 },
      { id: colIngredients, name: 'Ingredients', type: 'text', width: 280 },
      { id: colSteps, name: 'Steps', type: 'text', width: 340 },
      {
        id: colTags,
        name: 'Tags',
        type: 'multiselect',
        width: 160,
        options: [
          { id: uid('o'), label: 'vego', color: pickTagColor(2) },
          { id: uid('o'), label: 'quick', color: pickTagColor(5) },
          { id: uid('o'), label: 'favourite', color: pickTagColor(1) },
        ],
      },
      { id: colMade, name: 'Made it', type: 'checkbox', width: 90 },
    ];
    return { columns, view: base('grid') };
  }

  if (preset === 'casebrief') {
    const colCourt = uid('c');
    const colYear = uid('c');
    const colCite = uid('c');
    const colFacts = uid('c');
    const colIssue = uid('c');
    const colHolding = uid('c');
    const colReasoning = uid('c');
    const colNotes = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Case', type: 'text', width: 200 },
      { id: colCourt, name: 'Court', type: 'text', width: 140 },
      { id: colYear, name: 'Year', type: 'number', width: 80 },
      { id: colCite, name: 'Citation', type: 'text', width: 160 },
      { id: colFacts, name: 'Facts', type: 'text', width: 280 },
      { id: colIssue, name: 'Issue', type: 'text', width: 220 },
      { id: colHolding, name: 'Holding', type: 'text', width: 220 },
      { id: colReasoning, name: 'Reasoning', type: 'text', width: 280 },
      { id: colNotes, name: 'My notes', type: 'text', width: 220 },
    ];
    return { columns, view: base('grid') };
  }

  if (preset === 'statute') {
    const colSection = uid('c');
    const colSummary = uid('c');
    const colApplies = uid('c');
    const colNotes = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Statute', type: 'text', width: 200 },
      { id: colSection, name: 'Section', type: 'text', width: 120 },
      { id: colSummary, name: 'Summary', type: 'text', width: 320 },
      { id: colApplies, name: 'Applies to', type: 'text', width: 220 },
      { id: colNotes, name: 'Notes', type: 'text', width: 240 },
    ];
    return { columns, view: base('grid') };
  }

  if (preset === 'authority') {
    const colType = uid('c');
    const colCite = uid('c');
    const colLink = uid('c');
    const colFor = uid('c');
    const colRead = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Source', type: 'text', width: 220 },
      {
        id: colType,
        name: 'Type',
        type: 'select',
        width: 120,
        options: [
          { id: uid('o'), label: 'case', color: pickTagColor(1) },
          { id: uid('o'), label: 'statute', color: pickTagColor(2) },
          { id: uid('o'), label: 'article', color: pickTagColor(3) },
          { id: uid('o'), label: 'book', color: pickTagColor(5) },
          { id: uid('o'), label: 'other', color: pickTagColor(7) },
        ],
      },
      { id: colCite, name: 'Citation', type: 'text', width: 200 },
      { id: colLink, name: 'Link', type: 'url', width: 160 },
      { id: colFor, name: 'For', type: 'text', width: 160 },
      { id: colRead, name: 'Read', type: 'checkbox', width: 80 },
    ];
    return { columns, view: base('grid') };
  }

  if (preset === 'lecture') {
    const colCourse = uid('c');
    const colDate = uid('c');
    const colNotes = uid('c');
    const colFollow = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Topic', type: 'text', width: 200 },
      { id: colCourse, name: 'Course', type: 'text', width: 150 },
      { id: colDate, name: 'Date', type: 'date', width: 130 },
      { id: colNotes, name: 'Notes', type: 'text', width: 420 },
      { id: colFollow, name: 'Follow up', type: 'checkbox', width: 90 },
    ];
    return { columns, view: base('grid', { sorts: [{ id: uid('s'), columnId: colDate, dir: 'desc' }] }) };
  }

  if (preset === 'bills') {
    const colAmount = uid('c');
    const colCurrency = uid('c');
    const colDue = uid('c');
    const colPaid = uid('c');
    const colCategory = uid('c');
    const colAccount = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Bill', type: 'text', width: 180 },
      { id: colAmount, name: 'Amount', type: 'number', width: 110 },
      {
        id: colCurrency,
        name: 'Currency',
        type: 'select',
        width: 100,
        options: [
          { id: uid('o'), label: 'JPY', color: pickTagColor(1) },
          { id: uid('o'), label: 'SEK', color: pickTagColor(2) },
          { id: uid('o'), label: 'EUR', color: pickTagColor(3) },
          { id: uid('o'), label: 'USD', color: pickTagColor(5) },
        ],
      },
      { id: colDue, name: 'Due', type: 'reminder', width: 170 },
      { id: colPaid, name: 'Paid', type: 'checkbox', width: 70 },
      {
        id: colCategory,
        name: 'Category',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'rent', color: pickTagColor(1) },
          { id: uid('o'), label: 'utilities', color: pickTagColor(2) },
          { id: uid('o'), label: 'phone', color: pickTagColor(3) },
          { id: uid('o'), label: 'internet', color: pickTagColor(5) },
          { id: uid('o'), label: 'transit', color: pickTagColor(6) },
          { id: uid('o'), label: 'subscription', color: pickTagColor(7) },
        ],
      },
      { id: colAccount, name: 'Account', type: 'text', width: 140 },
    ];
    return { columns, view: base('grid', { sorts: [{ id: uid('s'), columnId: colDue, dir: 'asc' }] }) };
  }

  if (preset === 'routine') {
    const colCadence = uid('c');
    const colDone = uid('c');
    const colLast = uid('c');
    const colStreak = uid('c');
    const colSince = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Routine', type: 'text', width: 200 },
      {
        id: colCadence,
        name: 'Cadence',
        type: 'select',
        width: 110,
        options: [
          { id: uid('o'), label: 'daily', color: pickTagColor(3) },
          { id: uid('o'), label: 'weekly', color: pickTagColor(5) },
          { id: uid('o'), label: 'monthly', color: pickTagColor(1) },
        ],
      },
      { id: colDone, name: 'Done today', type: 'checkbox', width: 90 },
      { id: colLast, name: 'Last done', type: 'date', width: 130 },
      { id: colStreak, name: 'Streak', type: 'number', width: 90 },
      // Live "days since": today() and the date are both day-indexes, so this
      // counts up on its own and tells you when a routine has slipped.
      { id: colSince, name: 'Days since', type: 'formula', width: 110, formula: 'today() - [Last done]', numberFormat: 'plain' },
    ];
    return { columns, view: base('grid', {}) };
  }

  if (preset === 'deadlines') {
    const colDate = uid('c');
    const colDays = uid('c');
    const colCategory = uid('c');
    const colNotes = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'What', type: 'text', width: 200 },
      { id: colDate, name: 'Date', type: 'date', width: 140 },
      // Live "days left": the date is a day-index, today() is too, so the
      // difference counts down on its own with no upkeep.
      { id: colDays, name: 'Days left', type: 'formula', width: 100, formula: '[Date] - today()', numberFormat: 'plain' },
      {
        id: colCategory,
        name: 'Type',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'visa', color: pickTagColor(1) },
          { id: uid('o'), label: 'lease', color: pickTagColor(2) },
          { id: uid('o'), label: 'travel', color: pickTagColor(3) },
          { id: uid('o'), label: 'birthday', color: pickTagColor(6) },
          { id: uid('o'), label: 'other', color: pickTagColor(7) },
        ],
      },
      { id: colNotes, name: 'Notes', type: 'text', width: 240 },
    ];
    return { columns, view: base('grid', { sorts: [{ id: uid('s'), columnId: colDate, dir: 'asc' }] }) };
  }

  if (preset === 'meals') {
    const colDay = uid('c');
    const colNotes = uid('c');
    const colMade = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Dish', type: 'text', width: 200 },
      {
        id: colDay,
        name: 'Day',
        type: 'select',
        width: 110,
        options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ id: uid('o'), label: d, color: pickTagColor(i + 1) })),
      },
      { id: colNotes, name: 'Notes', type: 'text', width: 320 },
      { id: colMade, name: 'Cooked', type: 'checkbox', width: 90 },
    ];
    return { columns, view: base('grid') };
  }

  if (preset === 'groceries') {
    const colQty = uid('c');
    const colAisle = uid('c');
    const colGot = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Item', type: 'text', width: 220 },
      { id: colQty, name: 'Qty', type: 'text', width: 90 },
      {
        id: colAisle,
        name: 'Aisle',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'produce', color: pickTagColor(2) },
          { id: uid('o'), label: 'fridge', color: pickTagColor(3) },
          { id: uid('o'), label: 'pantry', color: pickTagColor(5) },
          { id: uid('o'), label: 'household', color: pickTagColor(6) },
        ],
      },
      { id: colGot, name: 'Got it', type: 'checkbox', width: 80 },
    ];
    return { columns, view: base('grid') };
  }

  if (preset === 'campaign') {
    const colType = uid('c');
    const colGiver = uid('c');
    const colReward = uid('c');
    const colStatus = uid('c');
    const colNotes = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Quest', type: 'text', width: 200 },
      {
        id: colType,
        name: 'Type',
        type: 'select',
        width: 110,
        options: [
          { id: uid('o'), label: 'main', color: pickTagColor(1) },
          { id: uid('o'), label: 'side', color: pickTagColor(3) },
          { id: uid('o'), label: 'personal', color: pickTagColor(6) },
        ],
      },
      { id: colGiver, name: 'Giver', type: 'text', width: 150 },
      { id: colReward, name: 'Reward', type: 'text', width: 180 },
      {
        id: colStatus,
        name: 'Status',
        type: 'select',
        width: 110,
        options: [
          { id: uid('o'), label: 'open', color: pickTagColor(7) },
          { id: uid('o'), label: 'active', color: pickTagColor(2) },
          { id: uid('o'), label: 'done', color: pickTagColor(5) },
        ],
      },
      { id: colNotes, name: 'Notes', type: 'text', width: 280 },
    ];
    return { columns, view: base('board', { groupColumnId: colStatus }) };
  }

  if (preset === 'family') {
    const colCategory = uid('c');
    const colWho = uid('c');
    const colLink = uid('c');
    const colNotes = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Item', type: 'text', width: 200 },
      {
        id: colCategory,
        name: 'Category',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'docs', color: pickTagColor(1) },
          { id: uid('o'), label: 'contacts', color: pickTagColor(2) },
          { id: uid('o'), label: 'plans', color: pickTagColor(3) },
          { id: uid('o'), label: 'wishlist', color: pickTagColor(6) },
          { id: uid('o'), label: 'notes', color: pickTagColor(7) },
        ],
      },
      { id: colWho, name: 'Who', type: 'person', width: 150 },
      { id: colLink, name: 'Link', type: 'url', width: 150 },
      { id: colNotes, name: 'Notes', type: 'text', width: 300 },
    ];
    return { columns, view: base('grid') };
  }

  if (preset === 'packing') {
    const colCategory = uid('c');
    const colPriority = uid('c');
    const colPacked = uid('c');
    const colWho = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Item', type: 'text', width: 200 },
      {
        id: colCategory,
        name: 'Category',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'Clothes', color: pickTagColor(1) },
          { id: uid('o'), label: 'Toiletries', color: pickTagColor(2) },
          { id: uid('o'), label: 'Electronics', color: pickTagColor(3) },
          { id: uid('o'), label: 'Documents', color: pickTagColor(5) },
          { id: uid('o'), label: 'Meds', color: pickTagColor(6) },
          { id: uid('o'), label: 'Misc', color: pickTagColor(7) },
        ],
      },
      {
        id: colPriority,
        name: 'Priority',
        type: 'select',
        width: 130,
        // Option order is sort order, so P1 lands first (sortRows reads it).
        options: [
          { id: uid('o'), label: 'P1 essential', color: pickTagColor(0) },
          { id: uid('o'), label: 'P2 important', color: pickTagColor(3) },
          { id: uid('o'), label: 'P3 nice-to-have', color: pickTagColor(7) },
        ],
      },
      // agg 'count' makes the footer show "packed / total" (see SummaryRow).
      { id: colPacked, name: 'Packed', type: 'checkbox', width: 100, agg: 'count' },
      { id: colWho, name: 'Who', type: 'person', width: 150 },
    ];
    return {
      columns,
      view: base('grid', {
        groupColumnId: colCategory, // board view, if switched to, groups by category
        sorts: [
          { id: uid('s'), columnId: colPriority, dir: 'asc' },
          { id: uid('s'), columnId: colCategory, dir: 'asc' },
        ],
      }),
    };
  }

  if (preset === 'reservation') {
    const colPlace = uid('c');
    const colWhen = uid('c');
    const colParty = uid('c');
    const colConf = uid('c');
    const colFile = uid('c');
    const colCost = uid('c');
    const colStatus = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Name', type: 'text', width: 190 },
      { id: colPlace, name: 'Place', type: 'place', width: 180 },
      { id: colWhen, name: 'When', type: 'datetime', width: 160 },
      { id: colParty, name: 'Party', type: 'number', width: 80 },
      { id: colConf, name: 'Confirmation #', type: 'text', width: 140 },
      { id: colFile, name: 'File', type: 'attachment', width: 120 },
      { id: colCost, name: 'Cost', type: 'number', width: 100, numberFormat: 'yen' },
      {
        id: colStatus,
        name: 'Status',
        type: 'select',
        width: 130,
        options: [
          { id: uid('o'), label: 'Researching', color: pickTagColor(3) },
          { id: uid('o'), label: 'Booked', color: pickTagColor(1) },
          { id: uid('o'), label: 'Confirmed', color: pickTagColor(2) },
        ],
      },
    ];
    return {
      columns,
      view: base('schedule', {
        startTimeColumnId: colWhen,
        placeColumnId: colPlace,
        sorts: [{ id: uid('s'), columnId: colWhen, dir: 'asc' }],
      }),
    };
  }

  if (preset === 'poll') {
    // One column, one row per option. Votes ride on each row's reactions (a 👍),
    // so they're per-row records, concurrent votes don't clobber each other.
    const columns: Column[] = [{ id: colName, name: 'Option', type: 'text', width: 260 }];
    return { columns, view: base('grid') };
  }

  // A weighted random table you roll on (encounters, loot, rumors). Range is a
  // display-only label ("1-3"); Weight is the relative odds rollOnTable reads.
  if (preset === 'rolltable') {
    const colWeight = uid('c');
    const colResult = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Range', type: 'text', width: 90 },
      { id: colWeight, name: 'Weight', type: 'number', width: 90 },
      { id: colResult, name: 'Result', type: 'text', width: 300 },
    ];
    return { columns, view: base('grid') };
  }

  // Initiative tracker: sorted by Init descending. Roll init / damage / heal are
  // flow concerns (setExpr `dice("1d20")+[Init]`, increment `-[amount]`), the
  // preset lays out the columns; the DM wires a flow if they want auto-rolls.
  if (preset === 'combat') {
    const colInit = uid('c');
    const colHP = uid('c');
    const colMax = uid('c');
    const colCond = uid('c');
    const colTurn = uid('c');
    const columns: Column[] = [
      { id: colName, name: 'Combatant', type: 'text', width: 160 },
      { id: colInit, name: 'Init', type: 'number', width: 70 },
      { id: colHP, name: 'HP', type: 'number', width: 80 },
      { id: colMax, name: 'Max', type: 'number', width: 80 },
      {
        id: colCond,
        name: 'Conditions',
        type: 'multiselect',
        width: 200,
        options: ['Prone', 'Grappled', 'Poisoned', 'Stunned', 'Concentrating'].map((l, i) => ({ id: uid('o'), label: l, color: pickTagColor(i) })),
      },
      { id: colTurn, name: 'Active', type: 'checkbox', width: 70 },
    ];
    return { columns, view: base('grid', { sorts: [{ id: uid('s'), columnId: colInit, dir: 'desc' }] }) };
  }

  const colAmount = uid('c');
  const columns: Column[] = [
    { id: colName, name: 'Name', type: 'text', width: 200 },
    { id: colAmount, name: 'Amount', type: 'number', width: 120 },
  ];
  return { columns, view: base('grid') };
}

// Flat "% packed" for a checklist: how many rows have the given checkbox ticked,
// out of the total. Pure, the grid footer and any readout share it.
export function packedStat(rows: TableRow[], packedColumnId: string): { done: number; total: number; pct: number } {
  const total = rows.length;
  const done = rows.reduce((n, r) => (r.cells[packedColumnId] === true ? n + 1 : n), 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** True if dayIso falls within [start, end] (end defaults to start). Tolerant
 *  of reversed ranges. Dates compared as yyyy-mm-dd strings. */
export function spansDay(startIso: string | null, endIso: string | null, dayIso: string): boolean {
  if (!startIso) return false;
  const s = startIso.slice(0, 10);
  const e = (endIso ? endIso.slice(0, 10) : '') || s;
  const lo = s <= e ? s : e;
  const hi = s <= e ? e : s;
  return dayIso >= lo && dayIso <= hi;
}

// --- Geo / place helpers ----------------------------------------------------

export function geoOf(value: CellValue): GeoValue | null {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as GeoValue).lat === 'number') {
    return value as GeoValue;
  }
  return null;
}

/** Narrow a cell value to an attachment (a file embedded as a data URL). */
export function attachmentOf(value: CellValue): AttachmentValue | null {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as AttachmentValue).data === 'string') {
    return value as AttachmentValue;
  }
  return null;
}

export function firstPlaceColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.type === 'place');
}

// curvePoints, sample a quadratic Bézier between two lat/lon points, with the
// control point offset perpendicular to the segment so the connector bows out
// into a nice arc. Returns [lat,lon] points to feed a Leaflet polyline. Pure.
export function curvePoints(
  a: [number, number],
  b: [number, number],
  curvature = 0.22,
  steps = 28,
): [number, number][] {
  const [aLat, aLon] = a;
  const [bLat, bLon] = b;
  const mLat = (aLat + bLat) / 2;
  const mLon = (aLon + bLon) / 2;
  const dLat = bLat - aLat;
  const dLon = bLon - aLon;
  // Perpendicular offset (consistent side → arcs curve the same way).
  const cLat = mLat - dLon * curvature;
  const cLon = mLon + dLat * curvature;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const lat = u * u * aLat + 2 * u * t * cLat + t * t * bLat;
    const lon = u * u * aLon + 2 * u * t * cLon + t * t * bLon;
    out.push([lat, lon]);
  }
  return out;
}

// --- Sub-items (row hierarchy) ----------------------------------------------
// Flatten rows into a parent→child tree in their existing (queried) order.
// Rows whose parent isn't in the set surface as roots, so a filtered-out or
// deleted parent never hides its children. Cycle-guarded.

export interface TreeRow {
  row: TableRow;
  depth: number;
  hasChildren: boolean;
}

export function buildRowTree(rows: TableRow[], collapsed: Set<string>): TreeRow[] {
  const ids = new Set(rows.map((r) => r.id));
  const childrenOf = new Map<string, TableRow[]>();
  for (const r of rows) {
    const parent = r.parent && ids.has(r.parent) && r.parent !== r.id ? r.parent : '';
    const bucket = childrenOf.get(parent) ?? [];
    bucket.push(r);
    childrenOf.set(parent, bucket);
  }
  const out: TreeRow[] = [];
  const visit = (parentId: string, depth: number, seen: Set<string>) => {
    for (const r of childrenOf.get(parentId) ?? []) {
      if (seen.has(r.id)) continue;
      const kids = childrenOf.get(r.id) ?? [];
      out.push({ row: r, depth, hasChildren: kids.length > 0 });
      if (kids.length && !collapsed.has(r.id)) visit(r.id, depth + 1, new Set(seen).add(r.id));
    }
  };
  visit('', 0, new Set());
  return out;
}
