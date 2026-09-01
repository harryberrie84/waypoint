import { useEffect, useReducer, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Wallet, Plus, X, Trash2 } from 'lucide-react';
import { netBalances, settleUp, type Expense } from '../lib/settle';
import { convert, getBaseCurrency, subscribeFx } from '../lib/fx';
import { publishRef, clearRef } from '../lib/refRegistry';

// budgetWidget, a self-contained split-the-bill budget (no table needed). Add the
// people splitting (anyone, by name, not just workspace members), log expenses with
// who paid and who shares each one, and it shows every person's net and the fewest
// transfers to settle up. The math is lib/settle (the same engine the table budget
// uses); currencies convert through fx. The total and each person's net are
// published so a table can read them with budget("name") and owed("name", "who").

interface BExpense {
  id: string;
  label: string;
  amount: number;
  currency: string;
  paidBy: string;
  split: string[]; // names sharing it; empty means everyone
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function money(n: number, base: string): string {
  return `${Math.round(n).toLocaleString()} ${base}`;
}

function BudgetWidgetView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const title = (node.attrs.title as string) || '';
  const base = ((node.attrs.base as string) || getBaseCurrency()).toUpperCase();
  const people = (node.attrs.people as string[]) || [];
  const expenses = (node.attrs.expenses as BExpense[]) || [];

  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeFx(bump), []);
  const [personDraft, setPersonDraft] = useState('');

  // Net per person and the transfers that settle it, plus the converted total.
  const list: Expense[] = expenses.map((e) => ({ amount: e.amount, currency: e.currency || base, paidBy: e.paidBy, splitAmong: e.split }));
  const balances = netBalances(list, people, base, convert);
  const transfers = settleUp(balances);
  let total = 0;
  for (const e of expenses) {
    if (!e.amount) continue;
    const inBase = e.currency && e.currency.toUpperCase() !== base ? convert(e.amount, e.currency, base) : e.amount;
    if (Number.isFinite(inBase)) total += inBase;
  }

  // Publish the total and each net so formulas elsewhere can read them. Keyed on
  // the actual values (serialised) so it only re-runs on a real change, never
  // churning the registry on every render.
  useEffect(() => {
    if (!title.trim()) return;
    publishRef('budget:', title, total);
    for (const p of people) publishRef('owed:', `${title}|${p}`, balances[p] ?? 0);
    return () => {
      clearRef('budget:', title);
      for (const p of people) clearRef('owed:', `${title}|${p}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, total, people.join('|'), people.map((p) => balances[p] ?? 0).join(',')]);

  const setExpenses = (next: BExpense[]) => updateAttributes({ expenses: next });
  const patchExpense = (id: string, p: Partial<BExpense>) => setExpenses(expenses.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const addExpense = () =>
    setExpenses([...expenses, { id: newId(), label: '', amount: 0, currency: base, paidBy: people[0] ?? '', split: [] }]);
  const addPerson = () => {
    const name = personDraft.trim();
    if (!name || people.some((p) => p.toLowerCase() === name.toLowerCase())) {
      setPersonDraft('');
      return;
    }
    updateAttributes({ people: [...people, name] });
    setPersonDraft('');
  };
  const removePerson = (name: string) =>
    updateAttributes({
      people: people.filter((p) => p !== name),
      expenses: expenses.map((e) => ({ ...e, paidBy: e.paidBy === name ? '' : e.paidBy, split: e.split.filter((s) => s !== name) })),
    });
  const toggleSplit = (id: string, name: string) => {
    const e = expenses.find((x) => x.id === id);
    if (!e) return;
    const has = e.split.includes(name);
    patchExpense(id, { split: has ? e.split.filter((s) => s !== name) : [...e.split, name] });
  };

  const nets = people
    .map((p) => ({ name: p, amount: balances[p] ?? 0 }))
    .filter((n) => Math.abs(n.amount) >= 0.5)
    .sort((a, b) => b.amount - a.amount);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-4 dark:border-coal-line dark:bg-coal/40">
        <div className="mb-3 flex items-center gap-2">
          <Wallet className="h-4 w-4 shrink-0 text-clay" />
          <input
            value={title}
            onChange={(e) => updateAttributes({ title: e.target.value })}
            readOnly={!editable}
            placeholder="Trip budget"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold text-ink outline-none dark:text-coal-text"
          />
          <input
            value={base}
            onChange={(e) => updateAttributes({ base: e.target.value.toUpperCase().slice(0, 3) })}
            readOnly={!editable}
            title="Base currency"
            className="w-14 rounded-md border border-paper-line bg-paper px-1.5 py-1 text-center text-xs font-medium uppercase text-ink-soft outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-soft"
          />
        </div>

        {/* People splitting */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {people.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-xs text-ink dark:bg-coal-panel dark:text-coal-text">
              {p}
              {editable && (
                <button type="button" onClick={() => removePerson(p)} className="text-ink-faint hover:text-rose-500" title={`Remove ${p}`}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {editable && (
            <input
              value={personDraft}
              onChange={(e) => setPersonDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPerson();
                }
              }}
              onBlur={addPerson}
              placeholder="add a person…"
              className="w-28 rounded-full border border-dashed border-paper-line bg-transparent px-2 py-0.5 text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:text-coal-text"
            />
          )}
        </div>

        {/* Expenses */}
        <div className="space-y-1.5">
          {expenses.map((e) => (
            <div key={e.id} className="rounded-lg border border-paper-line bg-paper px-2 py-1.5 dark:border-coal-line dark:bg-coal-panel">
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={e.label}
                  onChange={(ev) => patchExpense(e.id, { label: ev.target.value })}
                  readOnly={!editable}
                  placeholder="what for"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none dark:text-coal-text"
                />
                <input
                  type="number"
                  value={e.amount || ''}
                  onChange={(ev) => patchExpense(e.id, { amount: Number(ev.target.value.replace(',', '.')) || 0 })}
                  readOnly={!editable}
                  placeholder="0"
                  className="w-20 rounded border border-paper-line bg-transparent px-1.5 py-0.5 text-right text-sm tabular-nums text-ink outline-none dark:border-coal-line dark:text-coal-text"
                />
                <input
                  value={e.currency || base}
                  onChange={(ev) => patchExpense(e.id, { currency: ev.target.value.toUpperCase().slice(0, 3) })}
                  readOnly={!editable}
                  className="w-12 rounded border border-paper-line bg-transparent px-1 py-0.5 text-center text-xs uppercase text-ink-soft outline-none dark:border-coal-line dark:text-coal-soft"
                />
                <select
                  value={e.paidBy}
                  onChange={(ev) => patchExpense(e.id, { paidBy: ev.target.value })}
                  disabled={!editable}
                  className="rounded border border-paper-line bg-transparent px-1 py-0.5 text-xs text-ink-soft outline-none dark:border-coal-line dark:text-coal-soft"
                  title="Paid by"
                >
                  <option value="">paid by…</option>
                  {people.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {editable && (
                  <button type="button" onClick={() => setExpenses(expenses.filter((x) => x.id !== e.id))} className="text-ink-faint hover:text-rose-500" title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {people.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint dark:text-coal-soft">split</span>
                  {people.map((p) => {
                    const on = e.split.length === 0 || e.split.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => editable && toggleSplit(e.id, p)}
                        className={[
                          'rounded-full px-1.5 py-0.5 text-[10px]',
                          on ? 'bg-clay-wash text-clay dark:bg-clay/20' : 'bg-paper-panel text-ink-faint line-through dark:bg-coal-line dark:text-coal-soft',
                        ].join(' ')}
                      >
                        {p}
                      </button>
                    );
                  })}
                  {e.split.length === 0 && <span className="text-[10px] text-ink-faint dark:text-coal-soft">(everyone)</span>}
                </div>
              )}
            </div>
          ))}
          {editable && (
            <button
              type="button"
              onClick={addExpense}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-1.5 text-xs text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line"
            >
              <Plus className="h-3.5 w-3.5" /> Add an expense
            </button>
          )}
        </div>

        {/* Settle up */}
        <div className="mt-3 border-t border-paper-line pt-2 dark:border-coal-line">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-coal-soft">Total</span>
            <span className="text-sm font-semibold tabular-nums text-ink dark:text-coal-text">{money(total, base)}</span>
          </div>
          {nets.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {nets.map((n) => (
                <div key={n.name} className="flex items-baseline justify-between text-xs">
                  <span className="text-ink-soft dark:text-coal-soft">{n.name}</span>
                  <span className={n.amount >= 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-clay'}>
                    {n.amount >= 0 ? '+' : '-'}
                    {money(Math.abs(n.amount), base)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {transfers.length > 0 && (
            <div className="mt-2 space-y-1">
              {transfers.map((t, i) => (
                <div key={i} className="flex items-baseline justify-between rounded-md bg-paper px-2 py-1 text-xs dark:bg-coal-panel">
                  <span className="text-ink dark:text-coal-text">
                    <span className="font-medium">{t.from}</span> owes <span className="font-medium">{t.to}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-clay">{money(t.amount, base)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const BudgetWidget = Node.create({
  name: 'budgetWidget',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: '' },
      base: { default: '' },
      people: { default: [] },
      expenses: { default: [] },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-budget-widget]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const text = [node.attrs.title as string, ...((node.attrs.people as string[]) || [])].filter(Boolean).join(' ');
    return ['div', mergeAttributes(HTMLAttributes, { 'data-budget-widget': '' }), text];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BudgetWidgetView);
  },
});
