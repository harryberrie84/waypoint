import type { Column, ColumnType, CellValue, TableRow, NumberStyle } from '../types';
import { cellText } from './tableQuery';
import { formatValue } from './formula';
import { parseLocaleNumber } from './number';

type Roster = readonly { id: string; name: string }[];

// Human-facing cell text: numbers/formulas/rollups use their display format.
function displayText(value: CellValue, col: Column, members: Roster = []): string {
  if ((col.type === 'number' || col.type === 'formula' || col.type === 'rollup') && col.numberFormat && col.numberFormat !== 'plain') {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && value !== null && value !== undefined && value !== '') return formatValue(n, col.numberFormat);
  }
  return cellText(value, col, members);
}

// --- Export -----------------------------------------------------------------

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function tableToCSV(columns: Column[], rows: TableRow[], members: Roster = []): string {
  const header = columns.map((c) => csvEscape(c.name)).join(',');
  const body = rows
    .map((r) => columns.map((c) => csvEscape(cellText(r.cells[c.id] ?? null, c, members))).join(','))
    .join('\n');
  return body ? `${header}\n${body}` : header;
}

export function tableToMarkdown(columns: Column[], rows: TableRow[], members: Roster = []): string {
  const head = `| ${columns.map((c) => c.name).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((r) => `| ${columns.map((c) => displayText(r.cells[c.id] ?? null, c, members).replace(/\|/g, '\\|')).join(' | ')} |`)
    .join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

// --- Import (CSV or TSV, auto-detected) -------------------------------------

export function detectDelimiter(text: string): ',' | '\t' {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

/** Parse delimited text (handles quoted fields, embedded delimiters/newlines). */
export function parseDelimited(text: string, delimiter?: ',' | '\t'): { headers: string[]; rows: string[][] } {
  const delim = delimiter ?? detectDelimiter(text);
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  const nonEmpty = out.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = nonEmpty.length ? nonEmpty[0].map((h) => h.trim()) : [];
  return { headers, rows: nonEmpty.slice(1) };
}

const BOOL_RE = /^(true|false|yes|no|ja|nej|1|0|✓|✗|x|on|off)$/i;
const TRUE_RE = /^(true|yes|ja|1|✓|x|on)$/i;

// Infer a new column's type from its values (a Coda export marks booleans as
// "true"/"false"). All-boolean → checkbox, all-numeric → number, else text.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function inferType(values: string[], style: NumberStyle): ColumnType {
  if (!values.length) return 'text';
  if (values.every((v) => BOOL_RE.test(v))) return 'checkbox';
  // ISO dates before numbers (a plain year would otherwise read as a number, but a
  // full YYYY-MM-DD never parses as one). Lets a date column import as a real date,
  // so the calendar and timeline views work without retyping the column.
  if (values.every((v) => ISO_DATETIME_RE.test(v))) return 'datetime';
  if (values.every((v) => ISO_DATE_RE.test(v))) return 'date';
  if (values.every((v) => v !== '' && Number.isFinite(parseLocaleNumber(v, style)))) return 'number';
  return 'text';
}

function coerceImport(raw: string, type: ColumnType, style: NumberStyle): CellValue {
  if (type === 'number') {
    const n = parseLocaleNumber(raw, style);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === 'checkbox') return TRUE_RE.test(raw);
  return raw;
}

/**
 * Map parsed rows onto a table: reuse columns whose name matches a header
 * (case-insensitive), report which headers need new columns (with a type
 * inferred from the data, so a Coda true/false column becomes a checkbox), and
 * return the cell records to append. New-column ids are assigned by the caller.
 */
export function planImport(
  existing: Column[],
  parsed: { headers: string[]; rows: string[][] },
  style: NumberStyle = 'swedish',
): { newColumns: { name: string; type: ColumnType }[]; resolve: (newIds: Record<string, string>) => Record<string, CellValue>[] } {
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));
  const newColumns = parsed.headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && !byName.has(h.trim().toLowerCase()))
    .map(({ h, i }) => {
      const vals = parsed.rows.map((r) => (r[i] ?? '').trim()).filter((v) => v !== '');
      return { name: h, type: inferType(vals, style) };
    });
  const typeByName = new Map(newColumns.map((c) => [c.name.trim().toLowerCase(), c.type]));

  const resolve = (newIds: Record<string, string>): Record<string, CellValue>[] =>
    parsed.rows.map((cells) => {
      const rec: Record<string, CellValue> = {};
      parsed.headers.forEach((h, i) => {
        if (!h) return;
        const key = h.trim().toLowerCase();
        const existingCol = byName.get(key);
        const colId = existingCol ? existingCol.id : newIds[h];
        if (!colId) return;
        const raw = (cells[i] ?? '').trim();
        if (raw === '') return;
        const type = existingCol ? existingCol.type : (typeByName.get(key) ?? 'text');
        rec[colId] = coerceImport(raw, type, style);
      });
      return rec;
    });

  return { newColumns, resolve };
}
