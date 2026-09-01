import { useMemo } from 'react';
import { Wallet, Table2 } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { collectMoney, collectEvents, tripDaySpan, pageTables, type MoneyLine } from '../lib/tripViews';
import { LockedBodyStrip } from './LockedBody';
import { ArrowRight } from 'lucide-react';
import { useMembers } from '../hooks/useMembers';
import { initials, avatarColor } from '../lib/avatar';
import { cellNumber } from '../lib/scope';
import { cellText } from '../lib/tableQuery';
import { collectSpend, byCategory, toExpenses, currencyOf } from '../lib/budgetRollup';
import { netBalances, settleUp } from '../lib/settle';
import { isEnvelope } from '../lib/crypto';
import { formatValue } from '../lib/formula';

// BudgetTab, this page's money at a glance: sums every money column (number,
// formula, or rollup formatted as a currency) in the tables on this page,
// evaluating formulas/rollups just like the grid, grouped by table with a
// headline total per currency. A plain number ("Nights") is not money and is
// left out, set a column's format to ¥/kr/€/$ to include it.

function fmt(total: number, format: string): string {
  return formatValue(total, format);
}

export function BudgetTab({ pageId, body }: { pageId: string; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  // Encrypted pages keep an envelope in the store; PageView passes the decrypted body.
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const allTables = useWorkspaceTables();
  const rows = useData((s) => s.rows);

  const tables = useMemo(() => pageTables(page, allTables), [page, allTables]);
  const { lines, totalsByFormat } = useMemo(() => collectMoney(tables, rows), [tables, rows]);
  // Trip length from the dated rows on this page, so a total reads as a daily
  // pace ("about ¥12,000 / day over 9 days"). No dates => no pace shown.
  const days = useMemo(() => tripDaySpan(collectEvents(tables, rows)), [tables, rows]);

  // Group the lines under their table for a tidy breakdown.
  const byTable = useMemo(() => {
    const m = new Map<string, { name: string; lines: MoneyLine[] }>();
    for (const l of lines) {
      const g = m.get(l.tableId) ?? { name: l.tableName, lines: [] };
      g.lines.push(l);
      m.set(l.tableId, g);
    }
    return [...m.entries()];
  }, [lines]);

  // Per-ROW money, for the two questions a total cannot answer: what did we spend
  // it on, and who owes whom. Reading a cell to a number goes through the same
  // scope the grid uses, so formula and rollup columns count exactly as they do
  // there rather than being skipped.
  const members = useMembers();
  const spend = useMemo(
    () =>
      collectSpend(
        tables,
        rows,
        (row, table, col) => cellNumber(table, row, col, rows),
        (row, _table, col) => cellText(row.cells?.[col.id] ?? null, col),
      ),
    [tables, rows],
  );
  const categories = useMemo(() => byCategory(spend), [spend]);

  // Settle-up. The base currency is whichever money format carries the most, so a
  // yen-dominated trip settles in yen rather than an arbitrary default.
  const baseFormat = totalsByFormat.length ? totalsByFormat.reduce((a, b) => (b.total > a.total ? b : a)).format : '';
  const transfers = useMemo(() => {
    const base = currencyOf(baseFormat);
    if (!base) return [];
    const ids = members.map((m) => m.id);
    if (ids.length < 2) return []; // nobody to settle with
    return settleUp(netBalances(toExpenses(spend), ids, base));
  }, [spend, members, baseFormat]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';

  // Unreadable body: a strip, matching the other tabs. "We can't look" and "there
  // is nothing here" are different answers and the empty state only says the second.
  const unreadable = isEnvelope(stored?.content) && !body;

  if (lines.length === 0) {
    return (
      <div className="mx-auto h-full max-w-2xl px-3 py-4 sm:px-6">
        {unreadable && <LockedBodyStrip what="amounts" />}
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-clay-wash text-clay dark:bg-clay/15">
          <Wallet className="h-5 w-5" />
        </div>
        <p className="text-sm text-ink-soft dark:text-coal-soft">No amounts yet.</p>
        <p className="max-w-xs text-xs text-ink-faint dark:text-coal-soft">
          Add a table to this page and give a number or formula column a <span className="font-medium">currency format</span>
          (¥ / kr / € / $); its total shows up here, formulas included.
        </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-3 py-4 sm:px-6">
      {unreadable && <LockedBodyStrip what="amounts" />}
      {/* headline totals, one card per currency */}
      <div className="mb-4 flex flex-wrap gap-2">
        {totalsByFormat.map((t) => (
          <div key={t.format} className="flex-1 rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/60 to-paper-panel/40 p-4 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">
              <Wallet className="h-3.5 w-3.5 text-clay" /> Total{totalsByFormat.length > 1 ? ` · ${t.format}` : ''}
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-ink dark:text-coal-text">{fmt(t.total, t.format)}</div>
            {days > 1 && (
              <div className="mt-1 text-[11px] text-ink-faint dark:text-coal-soft">
                about {fmt(t.total / days, t.format)} / day over {days} days
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Where it went. A total tells you how much; this tells you what on, which
          is the question you actually argue about. One block per currency, since
          adding yen to kronor would be nonsense. */}
      {categories.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-xl border border-paper-line dark:border-coal-line">
          <div className="border-b border-paper-line bg-paper-panel/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:border-coal-line dark:bg-coal-line/40 dark:text-coal-soft">
            By category
          </div>
          <div className="space-y-2 p-3">
            {categories.map((c) => (
              <div key={`${c.format}:${c.category}`}>
                <div className="mb-0.5 flex items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink dark:text-coal-text">{c.category}</span>
                  <span className="shrink-0 text-ink-faint dark:text-coal-soft">{c.count}</span>
                  <span className="shrink-0 font-mono tabular-nums font-medium text-ink dark:text-coal-text">{fmt(c.total, c.format)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-paper-panel dark:bg-coal-line">
                  <div className="h-full rounded-full bg-clay" style={{ width: `${Math.round(c.share * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Who owes whom. The split math and the currency conversion were both
          already written and unused here; this is the surface for them. */}
      {transfers.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-xl border border-paper-line dark:border-coal-line">
          <div className="border-b border-paper-line bg-paper-panel/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:border-coal-line dark:bg-coal-line/40 dark:text-coal-soft">
            Settle up
          </div>
          <ul className="divide-y divide-paper-line p-0 dark:divide-coal-line">
            {transfers.map((t, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ backgroundColor: avatarColor(t.from) }}>
                  {initials(nameOf(t.from))}
                </span>
                <span className="text-ink dark:text-coal-text">{nameOf(t.from)}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-ink-faint" />
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ backgroundColor: avatarColor(t.to) }}>
                  {initials(nameOf(t.to))}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink dark:text-coal-text">{nameOf(t.to)}</span>
                <span className="shrink-0 font-mono tabular-nums font-semibold text-clay">{fmt(t.amount, baseFormat)}</span>
              </li>
            ))}
          </ul>
          <p className="px-3 pb-2 pt-1 text-[10px] text-ink-faint dark:text-coal-soft">
            Fewest transfers that clear everyone. Rows with no payer are left out; set a
            person column to say who paid, and a second one for who shares it.
          </p>
        </div>
      )}

      {/* per-table breakdown */}
      <div className="space-y-3">
        {byTable.map(([tableId, g]) => (
          <div key={tableId} className="overflow-hidden rounded-xl border border-paper-line dark:border-coal-line">
            <div className="flex items-center gap-1.5 border-b border-paper-line bg-paper-panel/50 px-3 py-1.5 text-xs font-semibold text-ink-soft dark:border-coal-line dark:bg-coal-line/40 dark:text-coal-soft">
              <Table2 className="h-3.5 w-3.5 text-clay" /> {g.name}
            </div>
            <div className="divide-y divide-paper-line dark:divide-coal-line">
              {g.lines.map((l) => (
                <div key={l.columnId} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">{l.columnName}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">{l.count} item{l.count === 1 ? '' : 's'}</span>
                  <span className="w-28 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-ink dark:text-coal-text">{fmt(l.total, l.format)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
