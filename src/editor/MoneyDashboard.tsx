import { useEffect, useMemo, useReducer } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { PiggyBank } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { getBaseCurrency, setBaseCurrency, subscribeFx, ratesAreStale, convert } from '../lib/fx';
import { formatValue } from '../lib/formula';
import type { Column, TableData, TableRow, NumberFormat } from '../types';

// ---------------------------------------------------------------------------
// moneyDashboard, a read-only roll-up across every money table in the workspace
// (anything with an Amount-ish number column, so /bills and /budget both count).
// Sums into the base currency and into yen at once, breaks it down per table,
// and projects six months. Reads decrypted cells live from the store, so it
// works under encryption with no extra handling: nothing is recomputed or stored
// server-side, the convert() rates are public, and the result never persists.
// ---------------------------------------------------------------------------

const FMT_BY_CODE: Record<string, NumberFormat> = { JPY: 'yen', SEK: 'sek', EUR: 'eur', USD: 'usd' };
const PICKABLE = ['JPY', 'SEK', 'EUR', 'USD'];

function money(n: number, code: string): string {
  const tok = FMT_BY_CODE[code.toUpperCase()];
  return tok ? formatValue(Math.round(n), tok) : `${Math.round(n).toLocaleString()} ${code.toUpperCase()}`;
}

// A money table is one with a number column that reads like an amount.
function amountColumn(t: TableData): Column | undefined {
  return t.columns.find((c) => c.type === 'number' && /amount|cost|price|total|spend/i.test(c.name));
}
function currencyColumn(t: TableData): Column | undefined {
  return t.columns.find((c) => c.type === 'select' && /currency/i.test(c.name));
}
function currencyOf(col: Column | undefined, row: TableRow): string {
  if (!col) return 'JPY';
  const label = (col.options ?? []).find((o) => o.id === row.cells[col.id])?.label;
  return (label || 'JPY').toUpperCase();
}

function MoneyDashboardView({ updateAttributes, editor }: NodeViewProps) {
  const rowsMap = useData((s) => s.rows);
  const tables = useWorkspaceTables();

  // Re-render when rates land or the base currency changes.
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeFx(bump), []);
  useEffect(() => {
    if (ratesAreStale()) void useData.getState().refreshRates();
  }, []);

  const base = getBaseCurrency();
  const baseCode = base.toUpperCase();

  const { perTable, totalBase, totalJpy, missing } = useMemo(() => {
    const moneyTables = tables.filter((t) => !t.formKey && amountColumn(t));
    let totalBase = 0;
    let totalJpy = 0;
    let missing = 0;
    const perTable = moneyTables
      .map((t) => {
        const aCol = amountColumn(t)!;
        const cCol = currencyColumn(t);
        let sumBase = 0;
        for (const r of Object.values(rowsMap)) {
          if (r.table !== t.id) continue;
          const amt = typeof r.cells[aCol.id] === 'number' ? (r.cells[aCol.id] as number) : 0;
          if (!amt) continue;
          const cur = currencyOf(cCol, r);
          const inBase = cur === baseCode ? amt : convert(amt, cur, base);
          const inJpy = cur === 'JPY' ? amt : convert(amt, cur, 'JPY');
          if (Number.isFinite(inBase)) {
            sumBase += inBase;
            totalBase += inBase;
          } else {
            missing++;
          }
          if (Number.isFinite(inJpy)) totalJpy += inJpy;
        }
        return { id: t.id, name: t.name || 'Untitled table', total: sumBase };
      })
      .filter((x) => Math.round(x.total) !== 0)
      .sort((a, b) => b.total - a.total);
    return { perTable, totalBase, totalJpy, missing };
  }, [tables, rowsMap, base, baseCode]);

  const max = perTable.reduce((m, p) => Math.max(m, p.total), 0);

  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-3 dark:border-coal-line dark:bg-coal/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <PiggyBank className="h-3.5 w-3.5 text-clay" /> money
          </div>
          <label className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
            in
            <select
              value={PICKABLE.includes(baseCode) ? baseCode : ''}
              onChange={(e) => {
                setBaseCurrency(e.target.value);
                updateAttributes({ base: e.target.value });
              }}
              disabled={!editor.isEditable}
              className="rounded-md border border-paper-line bg-paper px-1.5 py-0.5 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
            >
              {!PICKABLE.includes(baseCode) && <option value="">{baseCode}</option>}
              {PICKABLE.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        {perTable.length === 0 ? (
          <p className="text-sm text-ink-faint dark:text-coal-soft">
            no money tables here yet. add a /bills or /budget table and it shows up.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-2xl font-semibold tabular-nums text-ink dark:text-coal-text">{money(totalBase, base)}</span>
              {baseCode !== 'JPY' && (
                <span className="text-sm tabular-nums text-ink-faint dark:text-coal-soft">{money(totalJpy, 'JPY')}</span>
              )}
            </div>
            <p className="text-[11px] text-ink-faint dark:text-coal-soft">
              across your money tables. six months at this rate is {money(totalBase * 6, base)}.
            </p>

            <div className="mt-3 space-y-1 border-t border-paper-line/70 pt-2 dark:border-coal-line/70">
              {perTable.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate text-ink-soft dark:text-coal-soft">{p.name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-line/60 dark:bg-coal-line">
                    <span className="block h-full rounded-full bg-clay" style={{ width: `${max ? (p.total / max) * 100 : 0}%` }} />
                  </span>
                  <span className="w-24 shrink-0 text-right tabular-nums text-ink-soft dark:text-coal-soft">{money(p.total, base)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {missing > 0 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {missing} amount{missing === 1 ? '' : 's'} left out, no rate for its currency yet.
          </p>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const MoneyDashboard = Node.create({
  name: 'moneyDashboard',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      base: { default: '' }, // seed for export/paste; the live base is the workspace one
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-money-dashboard]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-money-dashboard': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MoneyDashboardView);
  },
});
