// ---------------------------------------------------------------------------
// budgetRollup, per-ROW money for the Budget tab: who paid, who shares it, and
// what kind of spend it was.
// ---------------------------------------------------------------------------
// collectMoney sums money COLUMNS, which answers "how much" but not "who owes
// whom" or "where did it go". Both of those need the individual rows, so this
// walks them: a money column for the amount, a person column for who paid (and
// optionally a second for who it is split among), and a select column for the
// category.
//
// Pure and injected: cell reading is passed in, so this tests without React and
// without the formula engine's React-side scope.

import type { Column, TableData, TableRow } from '../types';
import type { Expense } from './settle';

const CURRENCY_FORMATS = new Set(['yen', 'sek', 'eur', 'usd']);
/** fx wants an ISO code; the app stores a format name on the column. */
const FORMAT_CURRENCY: Record<string, string> = { yen: 'JPY', sek: 'SEK', eur: 'EUR', usd: 'USD' };

export function currencyOf(format: string | undefined): string {
  return FORMAT_CURRENCY[format ?? ''] ?? '';
}

export interface SpendRow {
  rowId: string;
  tableId: string;
  tableName: string;
  label: string; // the row's title, for a line item
  amount: number;
  format: string; // the column's number format (yen/sek/...)
  currency: string; // ISO, '' when unknown
  paidBy: string; // user id, '' when there is no person column or it is empty
  splitAmong: string[]; // user ids; empty = everyone
  category: string; // select option label, '' when the table has no select column
}

export function isMoneyColumn(c: Column): boolean {
  return (c.type === 'number' || c.type === 'formula' || c.type === 'rollup') && !!c.numberFormat && CURRENCY_FORMATS.has(c.numberFormat);
}

/** Ids out of a person cell, which may hold one id or an array. */
function personIds(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && !!v);
  return [];
}

/**
 * Every money-bearing row across the tables.
 *
 * `readNumber` computes a cell to a number the way the grid does (so formula and
 * rollup columns count), and `readText` renders a cell as text (for the title and
 * the category label). Both are passed in because they need the app's formula
 * scope, which is not available to a pure module.
 */
export function collectSpend(
  tables: TableData[],
  rowsById: Record<string, TableRow>,
  readNumber: (row: TableRow, table: TableData, col: Column) => number | null,
  readText: (row: TableRow, table: TableData, col: Column) => string,
): SpendRow[] {
  const out: SpendRow[] = [];
  const all = Object.values(rowsById);

  for (const t of tables) {
    const moneyCols = (t.columns ?? []).filter(isMoneyColumn);
    if (!moneyCols.length) continue;

    const people = (t.columns ?? []).filter((c) => c.type === 'person');
    // First person column is the payer; a second, if present, is who shares it.
    const payerCol = people[0];
    const splitCol = people[1];
    const catCol = (t.columns ?? []).find((c) => c.type === 'select');
    const titleCol = (t.columns ?? []).find((c) => c.type === 'text') ?? t.columns?.[0];

    for (const r of all.filter((x) => x.table === t.id)) {
      for (const c of moneyCols) {
        const amount = readNumber(r, t, c);
        if (amount == null || !Number.isFinite(amount) || amount === 0) continue;
        out.push({
          rowId: r.id,
          tableId: t.id,
          tableName: t.name || 'Table',
          label: titleCol ? readText(r, t, titleCol) || 'Untitled' : 'Untitled',
          amount,
          format: c.numberFormat ?? '',
          currency: currencyOf(c.numberFormat),
          paidBy: payerCol ? (personIds(r.cells?.[payerCol.id])[0] ?? '') : '',
          splitAmong: splitCol ? personIds(r.cells?.[splitCol.id]) : [],
          category: catCol ? readText(r, t, catCol) : '',
        });
      }
    }
  }
  return out;
}

/** Spend rows as settle-up expenses. Rows with no payer cannot be settled (nobody
 *  put money down), so they are left out rather than silently assigned. */
export function toExpenses(spend: SpendRow[]): Expense[] {
  return spend
    .filter((s) => s.paidBy)
    .map((s) => ({ amount: s.amount, currency: s.currency, paidBy: s.paidBy, splitAmong: s.splitAmong }));
}

export interface CategoryTotal {
  category: string;
  format: string;
  total: number;
  count: number;
  /** Share of its own currency's total, 0-1, for the bar. */
  share: number;
}

/** Totals per category, kept per currency: adding yen to kronor is nonsense. */
export function byCategory(spend: SpendRow[]): CategoryTotal[] {
  const key = (s: SpendRow) => `${s.format}\u0000${s.category || 'Uncategorised'}`;
  const acc = new Map<string, CategoryTotal>();
  const perFormat = new Map<string, number>();

  for (const s of spend) {
    const k = key(s);
    const cur = acc.get(k) ?? { category: s.category || 'Uncategorised', format: s.format, total: 0, count: 0, share: 0 };
    cur.total += s.amount;
    cur.count += 1;
    acc.set(k, cur);
    perFormat.set(s.format, (perFormat.get(s.format) ?? 0) + s.amount);
  }

  return [...acc.values()]
    .map((c) => ({ ...c, share: (perFormat.get(c.format) ?? 0) > 0 ? c.total / (perFormat.get(c.format) as number) : 0 }))
    .sort((a, b) => (a.format === b.format ? b.total - a.total : a.format.localeCompare(b.format)));
}
