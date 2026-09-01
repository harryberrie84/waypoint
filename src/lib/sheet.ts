// Spreadsheet, the pure half of the Sheet tab (`pages.sheet`). Cell addressing,
// range expansion, the dependency order, and evaluation. No React, no store.
//
// It does NOT contain an expression parser. There is one expression engine in
// this codebase (`lib/formula.ts`) and a spreadsheet is exactly the sort of thing
// that grows a second one, so instead a formula's cell references are handed to
// that engine as ordinary scope names: `A1` already tokenises as an identifier
// and scope lookup is already case-insensitive. The only thing this module has to
// do first is expand `A1:B3` into the cells it covers, because `:` is not a token
// the engine knows.
//
// A range expands to the cells that HAVE something in them, so sum/avg/count all
// ignore blanks the way a spreadsheet does, and an empty range is an empty
// argument list rather than a run of zeroes.

import { evaluateFormula, type FormulaValue, type FxResolve } from './formula';

export interface SheetChart {
  id: string;
  kind: 'bar' | 'line' | 'pie';
  /** Values to plot, e.g. "B2:B9". */
  range: string;
  /** Optional labels alongside, e.g. "A2:A9". */
  labels?: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetData {
  rows: number;
  cols: number;
  /** A1 -> raw input. "12", "hello", or "=SUM(A1:A3)". Absent means empty. */
  cells: Record<string, string>;
  charts?: SheetChart[];
  /** Column letter -> px width, for the ones dragged off the default. */
  widths?: Record<string, number>;
}

export const DEFAULT_ROWS = 40;
export const DEFAULT_COLS = 12;
export const MAX_ROWS = 500;
export const MAX_COLS = 52;

export const emptySheet = (): SheetData => ({ rows: DEFAULT_ROWS, cols: DEFAULT_COLS, cells: {} });

// --- addressing -------------------------------------------------------------

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colName(index: number): string {
  let i = Math.max(0, Math.floor(index));
  let out = '';
  for (;;) {
    out = String.fromCharCode(65 + (i % 26)) + out;
    if (i < 26) return out;
    i = Math.floor(i / 26) - 1;
  }
}

/** "A" -> 0, "AA" -> 26. Case-insensitive. -1 when it is not a column. */
export function colIndex(name: string): number {
  const s = name.trim().toUpperCase();
  if (!s || !/^[A-Z]+$/.test(s)) return -1;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const refName = (row: number, col: number): string => `${colName(col)}${row + 1}`;

/** "B3" -> { row: 2, col: 1 }. Null when it is not a reference. */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]{1,3})([0-9]{1,5})$/.exec(ref.trim());
  if (!m) return null;
  const col = colIndex(m[1]);
  const row = Number(m[2]) - 1;
  if (col < 0 || row < 0) return null;
  return { row, col };
}

/** Every reference a rectangle covers, row by row. Empty when either end is not
 *  a reference. Capped so a typo like A1:ZZ99999 cannot hang the tab. */
export function expandRange(from: string, to: string): string[] {
  const a = parseRef(from);
  const b = parseRef(to);
  if (!a || !b) return [];
  const r1 = Math.min(a.row, b.row);
  const r2 = Math.max(a.row, b.row);
  const c1 = Math.min(a.col, b.col);
  const c2 = Math.max(a.col, b.col);
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > 20000) return [];
  const out: string[] = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(refName(r, c));
  return out;
}

const RANGE_RE = /\b([A-Za-z]{1,3}[0-9]{1,5}):([A-Za-z]{1,3}[0-9]{1,5})\b/g;
const REF_RE = /\b([A-Za-z]{1,3}[0-9]{1,5})\b/g;

/** Rewrite `A1:B2` into `A1,A2,B1,B2`, keeping only the cells that hold
 *  something. A range of entirely empty cells becomes nothing at all, so
 *  `SUM(A1:A9)` over blanks is `SUM()` and answers 0 rather than summing zeroes. */
export function expandRanges(expr: string, filled: (ref: string) => boolean): string {
  return expr.replace(RANGE_RE, (_all, from: string, to: string) =>
    expandRange(from, to).filter(filled).join(',') || '""',
  );
}

/** Every cell a formula reads, ranges included. Used for the dependency order,
 *  so this counts empty cells too: a formula still depends on a cell that is
 *  blank right now and might not be a moment later. */
export function refsIn(expr: string): string[] {
  const out = new Set<string>();
  const flattened = expr.replace(RANGE_RE, (_all, from: string, to: string) => expandRange(from, to).join(','));
  for (const m of flattened.matchAll(REF_RE)) {
    // A bare word followed by "(" is a function name, not a reference, and a
    // reference is always letters-then-digits so SUM never matches anyway.
    if (parseRef(m[1])) out.add(m[1].toUpperCase());
  }
  return [...out];
}

// --- evaluation -------------------------------------------------------------

export interface CellResult {
  /** What to show. Empty string for an empty cell. */
  value: FormulaValue;
  /** Set when the formula could not be computed: '#CYCLE' or '#ERR'. */
  error?: string;
}

export const isFormula = (raw: string | undefined): boolean => typeof raw === 'string' && raw.trimStart().startsWith('=');

/** A literal cell's value: a number when it reads as one, otherwise its text. */
export function literalValue(raw: string): FormulaValue {
  const t = raw.trim();
  if (t === '') return '';
  // Number('') is 0 and Number(' ') is 0, both already handled above.
  const n = Number(t);
  return Number.isFinite(n) && /^[-+]?[0-9.]+(e[-+]?[0-9]+)?$/i.test(t) ? n : raw;
}

/**
 * Compute every cell. Literals resolve to themselves; formulas are evaluated in
 * dependency order so a formula never reads a stale neighbour. A reference cycle
 * marks every cell in it '#CYCLE' rather than looping, and a formula that throws
 * (or reads a cell that failed) is '#ERR' without taking the sheet down with it.
 */
export function evaluateSheet(data: SheetData, fx?: FxResolve): Record<string, CellResult> {
  const cells = data.cells ?? {};
  const upper: Record<string, string> = {};
  for (const [k, v] of Object.entries(cells)) if (typeof v === 'string' && v !== '') upper[k.toUpperCase()] = v;

  const out: Record<string, CellResult> = {};
  const scope: Record<string, FormulaValue> = {};
  for (const [ref, raw] of Object.entries(upper)) {
    if (isFormula(raw)) continue;
    const v = literalValue(raw);
    out[ref] = { value: v };
    scope[ref] = v;
  }

  const formulas = Object.keys(upper).filter((ref) => isFormula(upper[ref]));
  if (!formulas.length) return out;

  // Depth-first ordering with a colour mark, so a cycle is detected rather than
  // recursed into. grey = on the current path, black = already emitted.
  const order: string[] = [];
  const state = new Map<string, 'grey' | 'black'>();
  const bad = new Set<string>();
  const formulaSet = new Set(formulas);
  const visit = (ref: string, path: Set<string>) => {
    if (state.get(ref) === 'black') return;
    if (path.has(ref)) {
      for (const id of path) if (formulaSet.has(id)) bad.add(id);
      bad.add(ref);
      return;
    }
    path.add(ref);
    state.set(ref, 'grey');
    for (const dep of refsIn(upper[ref].replace(/^\s*=/, ''))) {
      if (formulaSet.has(dep)) visit(dep, path);
    }
    path.delete(ref);
    state.set(ref, 'black');
    order.push(ref);
  };
  for (const ref of formulas) visit(ref, new Set());

  for (const ref of order) {
    if (bad.has(ref)) {
      out[ref] = { value: '#CYCLE', error: '#CYCLE' };
      continue;
    }
    const body = upper[ref].replace(/^\s*=/, '');
    // A formula reading a cell that failed cannot itself be trusted.
    if (refsIn(body).some((d) => out[d]?.error)) {
      out[ref] = { value: '#ERR', error: '#ERR' };
      continue;
    }
    const expanded = expandRanges(body, (r) => upper[r] !== undefined);
    const result = evaluateFormula(expanded, scope, fx);
    if (!result.ok) {
      out[ref] = { value: '#ERR', error: result.error || '#ERR' };
      continue;
    }
    out[ref] = { value: result.value };
    scope[ref] = result.value;
  }
  for (const ref of bad) if (!out[ref]) out[ref] = { value: '#CYCLE', error: '#CYCLE' };
  return out;
}

// --- charts -----------------------------------------------------------------

export interface ChartPoint {
  label: string;
  value: number;
}

/** The points a chart plots: its value range, paired with its label range when
 *  it has one (and the index when it does not). Non-numeric values are dropped,
 *  so a header cell caught in the range does not become a zero-height bar. */
export function chartPoints(chart: SheetChart, results: Record<string, CellResult>): ChartPoint[] {
  const [vFrom, vTo] = chart.range.split(':');
  const valueRefs = vTo ? expandRange(vFrom, vTo) : [vFrom?.trim().toUpperCase() ?? ''];
  const [lFrom, lTo] = (chart.labels ?? '').split(':');
  const labelRefs = chart.labels ? (lTo ? expandRange(lFrom, lTo) : [lFrom.trim().toUpperCase()]) : [];
  const out: ChartPoint[] = [];
  valueRefs.forEach((ref, i) => {
    const cell = results[ref.toUpperCase()];
    if (!cell || cell.error) return;
    const n = typeof cell.value === 'number' ? cell.value : Number(cell.value);
    if (!Number.isFinite(n)) return;
    const labelCell = labelRefs[i] ? results[labelRefs[i]] : undefined;
    out.push({ label: labelCell ? String(labelCell.value) : String(i + 1), value: n });
  });
  return out;
}

/** Bar/line geometry in a 0..1 box, so the renderer only has to scale it. Zero
 *  and negative values are handled by anchoring to the smaller of 0 and the
 *  minimum, or a flat chart would draw off its own canvas. */
export function chartScale(points: ChartPoint[]): { min: number; max: number; span: number } {
  if (!points.length) return { min: 0, max: 1, span: 1 };
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  return { min, max, span };
}

/** Pie slice angles, in turns (0..1), skipping non-positive values which a pie
 *  cannot express. */
export function pieSlices(points: ChartPoint[]): { label: string; value: number; from: number; to: number }[] {
  const usable = points.filter((p) => p.value > 0);
  const total = usable.reduce((s, p) => s + p.value, 0);
  if (!total) return [];
  let at = 0;
  return usable.map((p) => {
    const from = at;
    at += p.value / total;
    return { label: p.label, value: p.value, from, to: at };
  });
}
