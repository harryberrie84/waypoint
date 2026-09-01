import type { Page, TableData, TableRow } from '../types';
import { rowTitle, isRowDone, attachmentOf } from './tableQuery';
import { cellNumber } from './scope';
import { extractTableIds } from './doc';

/** The tables that belong to THIS page: the ones embedded in its body plus its
 *  own kanban board. The trip tabs (Itinerary/Calendar/Budget) read only these,
 *  so a page's tab reflects that page, not the whole workspace. */
export function pageTables(page: Page | undefined, allTables: TableData[]): TableData[] {
  if (!page) return [];
  const ids = new Set(extractTableIds(page.content));
  const kb = page.kanban?.tableId;
  if (kb) ids.add(kb);
  return allTables.filter((t) => ids.has(t.id));
}

// Shared, pure data collectors behind the trip-level tabs (Itinerary, Calendar,
// Budget). They sweep every table in the workspace so the tabs show the whole
// trip at once, not one table. Kept pure so they're unit-testable and cheap.

export interface TripEvent {
  key: string; // rowId:columnId, stable per (row, date field)
  tableId: string;
  tableName: string;
  rowId: string;
  title: string;
  fieldName: string; // which date column this came from (e.g. "Check-in")
  dateIso: string; // the raw cell value (may include a time)
  day: string; // yyyy-mm-dd
  timeLabel: string; // "14:30" or ''
  done: boolean;
  widget?: boolean; // from a body widget (e.g. a reservation), not a table row: no rowId to open
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** Every row across the given tables that carries a date/datetime value, as one
 *  flat, date-sorted event list. A row with two date fields (check-in/out) yields
 *  two events. */
export function collectEvents(
  tables: TableData[],
  rowsById: Record<string, TableRow>,
  members: readonly { id: string; name: string }[] = [],
): TripEvent[] {
  const events: TripEvent[] = [];
  const allRows = Object.values(rowsById);
  for (const t of tables) {
    const dateCols = t.columns.filter((c) => c.type === 'date' || c.type === 'datetime');
    if (dateCols.length === 0) continue;
    const rows = allRows.filter((r) => r.table === t.id);
    for (const r of rows) {
      for (const dc of dateCols) {
        const v = r.cells[dc.id];
        if (typeof v !== 'string' || !ISO_DAY.test(v)) continue;
        const time = /[T ](\d{2}:\d{2})/.exec(v);
        const title = rowTitle(r.cells, t.columns, members);
        events.push({
          key: `${r.id}:${dc.id}`,
          tableId: t.id,
          tableName: t.name || 'Table',
          rowId: r.id,
          title: title || 'Untitled',
          fieldName: dc.name,
          dateIso: v,
          day: v.slice(0, 10),
          timeLabel: time ? time[1] : '',
          done: isRowDone(t, r),
        });
      }
    }
  }
  events.sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : 0));
  return events;
}

/** Dated reservations from the /reservations widget in a page's body, as calendar
 *  events, so a booking shows on the page's Calendar tab next to its dated rows.
 *  These carry no rowId (a widget item, nothing to "open"), flagged `widget` so the
 *  tab renders them read-only. Pure, so it's unit-testable. */
export function collectReservationEvents(page: Page | undefined): TripEvent[] {
  const out: TripEvent[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === 'reservationBlock' && Array.isArray(node.attrs?.items)) {
      const group = (node.attrs.title as string) || 'Reservations';
      for (const raw of node.attrs.items as unknown[]) {
        const it = raw as { id?: unknown; text?: unknown; when?: unknown };
        const when = typeof it.when === 'string' ? it.when : '';
        if (!when || !ISO_DAY.test(when)) continue;
        const time = /[T ](\d{2}:\d{2})/.exec(when);
        out.push({
          key: `res:${typeof it.id === 'string' ? it.id : out.length}`,
          tableId: '',
          tableName: group,
          rowId: '',
          title: (typeof it.text === 'string' && it.text) || 'Reservation',
          fieldName: 'Reservation',
          dateIso: when,
          day: when.slice(0, 10),
          timeLabel: time ? time[1] : '',
          done: false,
          widget: true,
        });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(page?.content);
  out.sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : 0));
  return out;
}

/** The inclusive From/To day range a row covers, for the rows where the pair is
 *  knowable: the table view's dateColumnId/endDateColumnId when both resolve to
 *  real date columns, else a table with EXACTLY two date columns (per row, the
 *  earlier value is From, the later is To). Only rows with BOTH cells filled on
 *  DIFFERENT days get an entry, so single-day rows and tables with 3+ unpaired
 *  date columns behave exactly as before. The Calendar tab uses this to draw a
 *  multi-day stay as a bar across its days instead of two lone chips. */
export function collectEventSpans(
  tables: TableData[],
  rowsById: Record<string, TableRow>,
): Map<string, { from: string; to: string }> {
  const spans = new Map<string, { from: string; to: string }>();
  const allRows = Object.values(rowsById);
  for (const t of tables) {
    const dateCols = t.columns.filter((c) => c.type === 'date' || c.type === 'datetime');
    if (dateCols.length < 2) continue;
    const v = (t.views ?? null) as { dateColumnId?: string; endDateColumnId?: string } | null;
    let fromCol = v?.dateColumnId ? dateCols.find((c) => c.id === v.dateColumnId) : undefined;
    let toCol = v?.endDateColumnId ? dateCols.find((c) => c.id === v.endDateColumnId) : undefined;
    if ((!fromCol || !toCol) && dateCols.length === 2) [fromCol, toCol] = dateCols;
    if (!fromCol || !toCol || fromCol.id === toCol.id) continue;
    for (const r of allRows) {
      if (r.table !== t.id) continue;
      const a = r.cells[fromCol.id];
      const b = r.cells[toCol.id];
      const av = typeof a === 'string' && ISO_DAY.test(a) ? a.slice(0, 10) : '';
      const bv = typeof b === 'string' && ISO_DAY.test(b) ? b.slice(0, 10) : '';
      if (!av || !bv || av === bv) continue;
      spans.set(r.id, av < bv ? { from: av, to: bv } : { from: bv, to: av });
    }
  }
  return spans;
}

/** Events bucketed by day (yyyy-mm-dd), day keys ascending, for the itinerary. */
export function eventsByDay(events: TripEvent[]): { day: string; events: TripEvent[] }[] {
  const map = new Map<string, TripEvent[]>();
  for (const e of events) {
    const arr = map.get(e.day) ?? [];
    arr.push(e);
    map.set(e.day, arr);
  }
  return [...map.keys()].sort().map((day) => ({ day, events: map.get(day)! }));
}

/** Inclusive day span of a dated event list: days from the first to the last
 *  event (1 when everything falls on one day, 0 when there are none). The Budget
 *  tab uses it to turn a total into a per-day pace. */
export function tripDaySpan(events: TripEvent[]): number {
  if (events.length === 0) return 0;
  const days = events.map((e) => e.day).sort();
  const [ay, am, ad] = days[0].split('-').map(Number);
  const [by, bm, bd] = days[days.length - 1].split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000) + 1;
}

export interface MoneyLine {
  tableId: string;
  tableName: string;
  columnId: string;
  columnName: string;
  format: string; // NumberFormat
  total: number;
  count: number; // how many rows contributed
}

// Which number formats mean "this column is money". A plain count ("Nights",
// "Days left") isn't money and must not be summed; a column formatted as a
// currency is. This is the signal, set a table column's format to ¥/kr/€/$.
const CURRENCY_FORMATS = new Set(['yen', 'sek', 'eur', 'usd']);

/** Sum every money column (number / formula / rollup with a currency format)
 *  across the tables, evaluating formulas and rollups just like the grid. Totals
 *  are grouped by currency (summing yen and sek together would be nonsense), so
 *  the Budget tab shows one headline per currency. */
export function collectMoney(
  tables: TableData[],
  rowsById: Record<string, TableRow>,
): { lines: MoneyLine[]; totalsByFormat: { format: string; total: number }[] } {
  const lines: MoneyLine[] = [];
  const totals = new Map<string, number>();
  const allRows = Object.values(rowsById);
  for (const t of tables) {
    const moneyCols = t.columns.filter(
      (c) => (c.type === 'number' || c.type === 'formula' || c.type === 'rollup') && c.numberFormat && CURRENCY_FORMATS.has(c.numberFormat),
    );
    if (moneyCols.length === 0) continue;
    const rows = allRows.filter((r) => r.table === t.id);
    for (const c of moneyCols) {
      let sum = 0;
      let count = 0;
      for (const r of rows) {
        const n = cellNumber(t, r, c, rowsById); // evaluates formula/rollup, reads number
        if (n !== null) {
          sum += n;
          count++;
        }
      }
      if (count === 0) continue;
      const format = c.numberFormat as string;
      lines.push({ tableId: t.id, tableName: t.name || 'Table', columnId: c.id, columnName: c.name, format, total: sum, count });
      totals.set(format, (totals.get(format) ?? 0) + sum);
    }
  }
  const totalsByFormat = [...totals.entries()].map(([format, total]) => ({ format, total }));
  return { lines, totalsByFormat };
}

// --- Media (Files + Moodboard) ----------------------------------------------

export interface MediaItem {
  key: string;
  name: string;
  url: string; // an http(s) url or a data: URL
  mime: string; // '' when unknown (an image block)
  size: number; // bytes, 0 when unknown
  isImage: boolean;
  isAudio: boolean;
  source: string; // where it came from, for a caption
  // Set only for an image block in the page BODY (not a cover or a table
  // attachment): the page it lives on and its current comment thread id, if any.
  // These let the shared previewer open/anchor a comment on the image itself.
  pageId?: string;
  threadId?: string;
}

function looksImage(mime: string, url: string): boolean {
  if (mime) return mime.startsWith('image/');
  return /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i.test(url);
}

function looksAudio(mime: string, url: string): boolean {
  if (mime) return mime.startsWith('audio/');
  return /^data:audio\//i.test(url) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|weba|opus)(\?|#|$)/i.test(url);
}

/** Every image and file attached to THIS page: image + file blocks in its body,
 *  its cover, and the attachment cells of the tables on it. Deduped by url. Pure,
 *  so the Files and Moodboard tabs (and tests) can share it. */
export function collectMedia(page: Page | undefined, tables: TableData[], rowsById: Record<string, TableRow>): MediaItem[] {
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  const push = (m: Omit<MediaItem, 'key'>) => {
    if (!m.url || seen.has(m.url)) return;
    seen.add(m.url);
    out.push({ ...m, key: `${out.length}` });
  };

  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      push({
        name: (node.attrs.alt as string) || 'Image',
        url: node.attrs.src,
        mime: '',
        size: 0,
        isImage: true,
        isAudio: false,
        source: 'Page body',
        pageId: page?.id,
        threadId: (node.attrs.threadId as string) || '',
      });
    } else if (node.type === 'audioBlock' && typeof node.attrs?.src === 'string') {
      const mime = (node.attrs.mime as string) || '';
      const name = (node.attrs.title as string) || (node.attrs.name as string) || 'Audio';
      push({ name, url: node.attrs.src as string, mime, size: (node.attrs.size as number) || 0, isImage: false, isAudio: true, source: 'Page body' });
    } else if (node.type === 'fileBlock' && typeof node.attrs?.data === 'string') {
      const mime = (node.attrs.mime as string) || '';
      const data = node.attrs.data as string;
      push({ name: (node.attrs.name as string) || 'File', url: data, mime, size: (node.attrs.size as number) || 0, isImage: looksImage(mime, data), isAudio: looksAudio(mime, data), source: 'Page body' });
    } else if (node.type === 'galleryBlock' && Array.isArray(node.attrs?.items)) {
      for (const it of node.attrs.items as { src?: unknown; alt?: unknown }[]) {
        if (it && typeof it.src === 'string') {
          push({ name: (typeof it.alt === 'string' && it.alt) || 'Image', url: it.src, mime: '', size: 0, isImage: true, isAudio: false, source: 'Gallery' });
        }
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(page?.content);

  if (page?.cover && /^(https?:|data:image)/i.test(page.cover)) {
    push({ name: 'Cover', url: page.cover, mime: '', size: 0, isImage: true, isAudio: false, source: 'Cover' });
  }

  const allRows = Object.values(rowsById);
  for (const t of tables) {
    const attCols = t.columns.filter((c) => c.type === 'attachment');
    if (attCols.length === 0) continue;
    const rows = allRows.filter((r) => r.table === t.id);
    for (const r of rows) {
      for (const c of attCols) {
        const a = attachmentOf(r.cells[c.id] ?? null);
        if (a) push({ name: a.name, url: a.data, mime: a.mime, size: a.size, isImage: looksImage(a.mime, a.data), isAudio: looksAudio(a.mime, a.data), source: t.name || 'Table' });
      }
    }
  }
  return out;
}
