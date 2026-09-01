// Aggregate "who owes whom" across every budget table the store can see. Each
// budget settles within itself (its own member set, so an empty "split among"
// means everyone on that trip); we net each table per person, sum those nets
// across tables, then settle the total into the fewest transfers. Pure.

import type { Column, TableData, TableRow } from '../types';
import { netBalances, settleUp, type Expense, type Transfer } from './settle';
import { getBaseCurrency } from './fx';

function colByName(cols: Column[], name: string): Column | undefined {
  return cols.find((c) => c.name === name);
}

function currencyOf(col: Column | undefined, row: TableRow): string {
  if (!col) return '';
  const v = row.cells[col.id];
  const label = (col.options ?? []).find((o) => o.id === v)?.label;
  return (label || '').toUpperCase();
}

function idsOf(col: Column | undefined, row: TableRow): string[] {
  if (!col) return [];
  const v = row.cells[col.id];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}

// A budget table is one with an Amount and a Paid by column (the budget preset).
function isBudgetTable(t: TableData): boolean {
  return !!colByName(t.columns, 'Amount') && !!colByName(t.columns, 'Paid by');
}

export interface OwesResult {
  transfers: Transfer[];
  net: Record<string, number>; // per person: positive = owed, negative = owes
  budgets: number;
}

export function whoOwesWhom(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  base: string = getBaseCurrency(),
): OwesResult {
  const total: Record<string, number> = {};
  let budgets = 0;

  for (const t of Object.values(tables)) {
    if (!isBudgetTable(t)) continue;
    const amountCol = colByName(t.columns, 'Amount');
    const currencyCol = colByName(t.columns, 'Currency');
    const paidCol = colByName(t.columns, 'Paid by');
    const splitCol = colByName(t.columns, 'Split among');

    const members = new Set<string>();
    const expenses: Expense[] = [];
    for (const r of Object.values(rows)) {
      if (r.table !== t.id) continue;
      const amount = typeof (amountCol && r.cells[amountCol.id]) === 'number' ? (r.cells[amountCol!.id] as number) : 0;
      const paidBy = idsOf(paidCol, r)[0] ?? '';
      const splitAmong = idsOf(splitCol, r);
      if (paidBy) members.add(paidBy);
      for (const id of splitAmong) members.add(id);
      if (amount) expenses.push({ amount, currency: currencyOf(currencyCol, r), paidBy, splitAmong });
    }
    if (members.size < 2 || expenses.length === 0) continue;
    budgets++;
    const net = netBalances(expenses, [...members], base);
    for (const [id, v] of Object.entries(net)) total[id] = (total[id] ?? 0) + v;
  }

  return { transfers: settleUp(total), net: total, budgets };
}
