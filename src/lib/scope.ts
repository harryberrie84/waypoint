import type { Column, CellValue, TableData, TableRow } from '../types';
import { evaluateFormula, type FormulaValue } from './formula';
import { cellText } from './tableQuery';
import { parseLocaleNumber } from './number';

// Pure formula-scope logic, lifted out of TableCell so libs (tripViews, the
// Budget tab's totals) can compute cells without dragging in React. TableCell
// re-exports buildScope/coerceNumber for its existing importers.

export function coerceNumber(v: CellValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseLocaleNumber(v); // accept "12,50" and "12.50" alike
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** day-index for an ISO date string, for date math in formulas. */
function dateToDayIndex(v: CellValue): number {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return 0;
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** day-index carrying time as a fraction, so datetime diffs read as days. */
function dateTimeToDays(v: CellValue): number {
  if (typeof v !== 'string') return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
  if (!m) return 0;
  const dayIdx = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
  const mins = m[4] !== undefined ? Number(m[4]) * 60 + Number(m[5]) : 0;
  return dayIdx + mins / 1440;
}

/** column name -> value, for evaluating a row's formula columns. Numbers/dates
 *  become day-indices or counts; text/select/place become strings so concat()
 *  and format() can build labels. */
export function buildScope(columns: Column[], cells: Record<string, CellValue>): Record<string, FormulaValue> {
  const scope: Record<string, FormulaValue> = {};
  // Pass 1: concrete bases.
  for (const c of columns) {
    if (c.type === 'number') scope[c.name] = coerceNumber(cells[c.id]);
    else if (c.type === 'date') scope[c.name] = dateToDayIndex(cells[c.id]);
    else if (c.type === 'datetime' || c.type === 'reminder') scope[c.name] = dateTimeToDays(cells[c.id]);
    else if (c.type === 'checkbox') scope[c.name] = cells[c.id] === true ? 1 : 0;
    else if (c.type === 'text' || c.type === 'url' || c.type === 'select' || c.type === 'multiselect' || c.type === 'place') {
      scope[c.name] = cellText(cells[c.id] ?? null, c);
    }
  }
  // Pass 2: formulas. Repeat until stable so a formula can reference another
  // formula regardless of column order (bounded by the count, so a cycle just
  // settles instead of looping forever).
  const formulaCols = columns.filter((c) => c.type === 'formula' && c.formula);
  for (let pass = 0; pass < formulaCols.length; pass++) {
    let changed = false;
    for (const c of formulaCols) {
      const v = evaluateFormula(c.formula as string, scope).value;
      if (scope[c.name] !== v) {
        scope[c.name] = v;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return scope;
}

/** Compute a column's numeric value for a row, matching the grid: raw for number,
 *  evaluated for formula, aggregated for rollup. Returns null when there's no
 *  number to read (blank cell, non-numeric formula result, missing relation), so
 *  callers can tell "no value" from a real 0. */
export function cellNumber(
  table: TableData,
  row: TableRow,
  col: Column,
  rowsMap: Record<string, TableRow>,
): number | null {
  if (col.type === 'number') {
    const v = row.cells[col.id];
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (col.type === 'formula') {
    const r = evaluateFormula(col.formula ?? '', buildScope(table.columns, row.cells));
    return r.ok && typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
  }
  if (col.type === 'rollup') {
    const relCol = table.columns.find((c) => c.id === col.rollupRelationColumnId);
    if (!relCol || !col.rollupTargetColumnId) return null;
    const relIds = Array.isArray(row.cells[relCol.id]) ? (row.cells[relCol.id] as string[]) : [];
    const nums: number[] = [];
    for (const rid of relIds) {
      const v = rowsMap[rid]?.cells[col.rollupTargetColumnId];
      if (typeof v === 'number') nums.push(v);
      else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) nums.push(Number(v));
    }
    const fn = col.rollupFn ?? 'sum';
    if (fn === 'count') return relIds.length;
    if (nums.length === 0) return 0;
    if (fn === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (fn === 'min') return Math.min(...nums);
    return Math.max(...nums);
  }
  return null;
}
