import { useEffect, useMemo, useReducer } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Scale } from 'lucide-react';
import { useData, selectRowsForTable } from '../store/useData';
import { useMembers } from '../hooks/useMembers';
import { netBalances, settleUp, type Expense } from '../lib/settle';
import { getBaseCurrency, setBaseCurrency, subscribeFx, ratesAreStale, convert } from '../lib/fx';
import { formatValue } from '../lib/formula';
import type { Column, TableRow, NumberFormat } from '../types';

// ---------------------------------------------------------------------------
// budgetSummary, read-only settlement readout bound to a /budget table. Reads
// the table's rows + the member roster live, nets every expense into base, and
// shows per-person balances plus the minimum transfers to settle up. Re-renders
// on row edits (the rows subscription) and on rate/base changes (subscribeFx).
// ---------------------------------------------------------------------------

const FMT_BY_CODE: Record<string, NumberFormat> = { JPY: 'yen', SEK: 'sek', EUR: 'eur', USD: 'usd' };
const PICKABLE = ['JPY', 'SEK', 'EUR', 'USD'];

function money(n: number, base: string): string {
  const tok = FMT_BY_CODE[base.toUpperCase()];
  return tok ? formatValue(Math.round(n), tok) : `${Math.round(n).toLocaleString()} ${base.toUpperCase()}`;
}

function colByName(columns: Column[], name: string): Column | undefined {
  return columns.find((c) => c.name === name);
}

// Resolve a Currency select cell to its ISO label; empty defaults to JPY, to
// match the table's "In base" column (which defaults the same way).
function currencyOf(col: Column | undefined, row: TableRow): string {
  if (!col) return 'JPY';
  const v = row.cells[col.id];
  const label = (col.options ?? []).find((o) => o.id === v)?.label;
  return (label || 'JPY').toUpperCase();
}

function idsOf(col: Column | undefined, row: TableRow): string[] {
  if (!col) return [];
  const v = row.cells[col.id];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}

function BudgetSummaryView({ node, updateAttributes, editor }: NodeViewProps) {
  const tableId = node.attrs.tableId as string;
  const table = useData((s) => s.tables[tableId]);
  // Stable rows map + useMemo, not a fresh array from the selector (zustand v5 has no
  // selector memoization; an uncacheable getSnapshot throws React #185). See PollBlock.
  const rowsMap = useData((s) => s.rows);
  const rows = useMemo(() => selectRowsForTable(rowsMap, tableId), [rowsMap, tableId]);
  const members = useMembers();

  // Re-render when rates land or the base currency changes (one source of truth).
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeFx(bump), []);
  useEffect(() => {
    if (ratesAreStale()) void useData.getState().refreshRates();
  }, []);

  const base = getBaseCurrency();

  const { nets, transfers, unconverted, byCategory } = useMemo(() => {
    const columns = table?.columns ?? [];
    const amountCol = colByName(columns, 'Amount');
    const currencyCol = colByName(columns, 'Currency');
    const paidCol = colByName(columns, 'Paid by');
    const splitCol = colByName(columns, 'Split among');
    const categoryCol = colByName(columns, 'Category');

    const expenses: Expense[] = rows.map((r) => ({
      amount: typeof (amountCol && r.cells[amountCol.id]) === 'number' ? (r.cells[amountCol!.id] as number) : 0,
      currency: currencyOf(currencyCol, r),
      paidBy: idsOf(paidCol, r)[0] ?? '',
      splitAmong: idsOf(splitCol, r),
    }));

    // Member set: the roster, or, in a roster-less workspace, whoever actually
    // appears in the paid-by / split cells.
    let memberIds = members.map((m) => m.id);
    if (memberIds.length === 0) {
      const seen = new Set<string>();
      for (const e of expenses) {
        if (e.paidBy) seen.add(e.paidBy);
        for (const id of e.splitAmong) seen.add(id);
      }
      memberIds = [...seen];
    }

    // Count expenses that can't convert (missing rate) so the total isn't poisoned.
    let unconverted = 0;
    for (const e of expenses) {
      if (e.amount && e.currency && e.currency !== base.toUpperCase() && !Number.isFinite(convert(e.amount, e.currency, base))) {
        unconverted++;
      }
    }

    const balances = netBalances(expenses, memberIds, base);
    const transfers = settleUp(balances);
    const nets = memberIds
      .map((id) => ({ id, amount: balances[id] ?? 0 }))
      .filter((n) => Math.abs(n.amount) >= 0.5)
      .sort((a, b) => b.amount - a.amount);

    // Spend-by-category, base-normalized, for a compact bar.
    const cat = new Map<string, number>();
    if (categoryCol) {
      for (let i = 0; i < rows.length; i++) {
        const e = expenses[i];
        const inBase = e.currency && e.currency !== base.toUpperCase() ? convert(e.amount, e.currency, base) : e.amount;
        if (!Number.isFinite(inBase) || inBase === 0) continue;
        const label = (categoryCol.options ?? []).find((o) => o.id === rows[i].cells[categoryCol.id])?.label ?? 'Uncategorized';
        cat.set(label, (cat.get(label) ?? 0) + inBase);
      }
    }
    const byCategory = [...cat.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);

    return { nets, transfers, unconverted, byCategory };
  }, [table, rows, members, base]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const catMax = byCategory.reduce((m, c) => Math.max(m, c.total), 0);

  if (!table) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="rounded-lg border border-dashed border-paper-line p-3 text-sm text-ink-faint dark:border-coal-line dark:text-coal-soft">
          budget table missing, it was deleted or hasn't loaded.
        </div>
      </NodeViewWrapper>
    );
  }

  const nothingToSettle = nets.length === 0 && transfers.length === 0;

  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Scale className="h-3.5 w-3.5 text-clay" /> settlement
          </div>
          <label className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
            settle in
            <select
              value={PICKABLE.includes(base.toUpperCase()) ? base.toUpperCase() : ''}
              onChange={(e) => {
                setBaseCurrency(e.target.value);
                updateAttributes({ base: e.target.value });
              }}
              disabled={!editor.isEditable}
              className="rounded-md border border-paper-line bg-paper px-1.5 py-0.5 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            >
              {!PICKABLE.includes(base.toUpperCase()) && <option value="">{base.toUpperCase()}</option>}
              {PICKABLE.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        {nothingToSettle ? (
          <p className="text-sm text-ink-faint dark:text-coal-soft">nothing to settle yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {nets.map((n) => (
                <span key={n.id} className="text-sm tabular-nums">
                  <span className="text-ink-soft dark:text-coal-soft">{nameOf(n.id)}</span>{' '}
                  <span className={n.amount >= 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-clay'}>
                    {n.amount >= 0 ? '+' : '−'}
                    {money(Math.abs(n.amount), base)}
                  </span>
                </span>
              ))}
            </div>

            {transfers.length > 0 && (
              <div className="mt-2 space-y-0.5 border-t border-paper-line/70 pt-2 dark:border-coal-line/70">
                {transfers.map((t, i) => (
                  <div key={i} className="text-sm text-ink dark:text-coal-text">
                    <span className="text-ink-soft dark:text-coal-soft">{nameOf(t.from)}</span> pays{' '}
                    <span className="text-ink-soft dark:text-coal-soft">{nameOf(t.to)}</span>{' '}
                    <span className="font-medium tabular-nums">{money(t.amount, base)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {byCategory.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-paper-line/70 pt-2 dark:border-coal-line/70">
            {byCategory.map((c) => (
              <div key={c.label} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 truncate text-ink-soft dark:text-coal-soft">{c.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-line/60 dark:bg-coal-line">
                  <span className="block h-full rounded-full bg-clay" style={{ width: `${catMax ? (c.total / catMax) * 100 : 0}%` }} />
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-ink-soft dark:text-coal-soft">{money(c.total, base)}</span>
              </div>
            ))}
          </div>
        )}

        {unconverted > 0 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {unconverted} expense{unconverted === 1 ? '' : 's'} left out, rates unavailable for its currency yet.
          </p>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const BudgetSummary = Node.create({
  name: 'budgetSummary',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tableId: { default: '' },
      base: { default: '' }, // seed for export/paste; the live base is the workspace one
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-budget-summary]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-budget-summary': '', 'data-table-id': HTMLAttributes.tableId })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BudgetSummaryView);
  },
});
