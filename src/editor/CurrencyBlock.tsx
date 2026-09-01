import { useEffect, useReducer, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ArrowLeftRight, Coins, Pin, PinOff, Plus, RefreshCw, X } from 'lucide-react';
import { convert, getBaseCurrency, knownCodes, ratesAreStale, ratesFetchedAt, subscribeFx } from '../lib/fx';
import {
  COMMON_CODES,
  buildLines,
  currencyName,
  defaultFxBoard,
  describeAge,
  formatAmount,
  formatInverse,
  formatRate,
  normalizeCode,
  parseAmount,
  swapBase,
  type FxBoardData,
  type FxRow,
} from '../lib/fxBoard';
import { uid } from '../lib/id';
import { useData } from '../store/useData';

// The currency board: one amount, and every currency you care about beside it.
// Shared by the /currency widget (state in node attrs) and the Currency page tab
// (state in pages.rates), the same split the tier list uses.
//
// "Live" is honest here rather than aspirational: the free keyless upstream
// behind lib/fx.ts publishes about once a day and the cache holds for twelve
// hours, so the header says when the rates are from and offers a refresh instead
// of implying a ticker. A pinned row overrides the rate with one you were
// actually quoted, and shows how far that sits from the day's rate.

export function CurrencyEditor({
  value,
  readLive,
  onChange,
  editable,
  big = false,
}: {
  value: FxBoardData;
  /** The value as it is RIGHT NOW, for writes. See the note in the node view. */
  readLive?: () => FxBoardData;
  onChange: (patch: Partial<FxBoardData>) => void;
  editable: boolean;
  big?: boolean;
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [adding, setAdding] = useState(false);
  // What's in the amount box while it's being typed. "12," and "" are both states
  // a number can't hold, so the text lives here and only parsed values are stored.
  const [draft, setDraft] = useState<string | null>(null);
  // The same, per pinned row. Without it, backspacing the pinned rate to empty
  // parses to null, which UNPINS the row: the box you were typing in disappears
  // and the row quietly goes back to the live rate.
  const [pinDraft, setPinDraft] = useState<Record<string, string>>({});
  const clearPinDraft = (id: string) => setPinDraft((d) => {
    const next = { ...d };
    delete next[id];
    return next;
  });

  // Recompute when fresh rates land or the base currency changes elsewhere.
  useEffect(() => subscribeFx(bump), []);
  useEffect(() => {
    if (ratesAreStale()) void useData.getState().refreshRates();
  }, []);

  const live = (): FxBoardData => readLive?.() ?? value;
  const patch = (p: Partial<FxBoardData>) => onChange({ ...live(), ...p });
  const setRows = (rows: FxRow[]) => patch({ rows });
  const editRow = (id: string, p: Partial<FxRow>) => setRows(live().rows.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const lines = buildLines(value, convert);
  const fetchedAt = ratesFetchedAt();
  const stale = ratesAreStale();
  const taken = new Set(lines.map((l) => l.row.code).concat(normalizeCode(value.base)));
  const offer = [...new Set([...COMMON_CODES, ...knownCodes()])].filter((c) => !taken.has(c));

  const addRow = (code: string) => {
    const c = normalizeCode(code);
    if (!c || taken.has(c)) return;
    setRows([...live().rows, { id: uid('fx'), code: c, note: '', manual: null }]);
    setAdding(false);
  };

  return (
    <div className={`rounded-xl border border-paper-line bg-paper-panel dark:border-coal-line dark:bg-coal-panel ${big ? 'p-4 sm:p-6' : 'p-3'}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Coins className="h-4 w-4 shrink-0 text-clay" />
        {editable ? (
          <input
            value={value.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Currency"
            className={`min-w-0 flex-1 bg-transparent font-display text-ink outline-none placeholder:text-ink-faint dark:text-coal-text ${big ? 'text-xl' : 'text-base'}`}
          />
        ) : (
          <span className={`min-w-0 flex-1 font-display text-ink dark:text-coal-text ${big ? 'text-xl' : 'text-base'}`}>{value.title || 'Currency'}</span>
        )}
        <span className={`text-xs ${stale ? 'text-ochre' : 'text-ink-faint dark:text-coal-soft'}`}>{describeAge(fetchedAt, Date.now())}</span>
        <button
          type="button"
          onClick={() => void useData.getState().refreshRates()}
          title="Fetch today's rates"
          className="rounded p-1 text-ink-faint hover:bg-clay-wash hover:text-clay dark:text-coal-soft"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <input
          value={draft ?? String(value.amount)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = parseAmount(e.target.value);
            if (n !== null) patch({ amount: n });
          }}
          onBlur={() => setDraft(null)}
          disabled={!editable}
          inputMode="decimal"
          className={`w-40 rounded-lg border border-paper-line bg-paper px-3 py-2 font-display text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text ${big ? 'text-2xl' : 'text-lg'}`}
        />
        <select
          value={normalizeCode(value.base)}
          onChange={(e) => patch({ base: normalizeCode(e.target.value) })}
          disabled={!editable}
          className="rounded-lg border border-paper-line bg-paper px-2 py-2 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
        >
          {[...new Set([normalizeCode(value.base), ...COMMON_CODES, ...knownCodes()])].filter(Boolean).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {editable && (
          <div className="flex gap-1">
            {[100, 1000, 10000].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { setDraft(null); patch({ amount: n }); }}
                className="rounded-full border border-paper-line px-2.5 py-1 text-xs text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {lines.map((l) => (
          <div key={l.row.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-clay-wash/40">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-sm text-ink dark:text-coal-text">{l.row.code}</span>
                <span className="truncate text-xs text-ink-faint dark:text-coal-soft">{currencyName(l.row.code)}</span>
                {l.drift !== null && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${l.drift < 0 ? 'bg-ochre-wash text-ochre' : 'bg-clay-wash text-clay'}`}>
                    {l.drift > 0 ? '+' : ''}{Math.round(l.drift * 1000) / 10}% vs today
                  </span>
                )}
                {/* Whose quote it was. The editable copy sits next to the rate, so
                    only show it up here when that input isn't on screen. */}
                {l.row.note && !(editable && l.row.manual !== null) && (
                  <span className="truncate text-xs italic text-ink-faint dark:text-coal-soft">{l.row.note}</span>
                )}
              </div>
              <div className="text-xs text-ink-faint dark:text-coal-soft">
                {formatRate(l.rate, value.base, l.row.code)}
                {formatInverse(l.rate, value.base, l.row.code) && <span className="ml-2">· {formatInverse(l.rate, value.base, l.row.code)}</span>}
              </div>
              {editable && l.row.manual !== null && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <input
                    value={pinDraft[l.row.id] ?? String(l.row.manual)}
                    onChange={(e) => {
                      setPinDraft((d) => ({ ...d, [l.row.id]: e.target.value }));
                      const n = parseAmount(e.target.value);
                      if (n !== null && n > 0) editRow(l.row.id, { manual: n });
                    }}
                    onBlur={() => clearPinDraft(l.row.id)}
                    inputMode="decimal"
                    placeholder="rate you were quoted"
                    className="w-32 rounded border border-paper-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  />
                  <input
                    value={l.row.note}
                    onChange={(e) => editRow(l.row.id, { note: e.target.value })}
                    placeholder="who quoted it"
                    className="w-36 rounded border border-paper-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  />
                </div>
              )}
            </div>

            <div className={`shrink-0 text-right font-display text-ink dark:text-coal-text ${big ? 'text-xl' : 'text-base'}`}>
              {formatAmount(l.value, l.row.code)}
            </div>

            {editable && (
              <div className="flex shrink-0 gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    clearPinDraft(l.row.id);
                    editRow(l.row.id, { manual: l.row.manual === null ? Math.round((l.rate ?? 1) * 10000) / 10000 : null });
                  }}
                  title={l.row.manual === null ? 'Pin a rate you were quoted' : 'Back to the live rate'}
                  className={`rounded p-1 hover:bg-clay-wash hover:text-clay ${l.row.manual === null ? 'text-ink-faint dark:text-coal-soft' : 'text-clay'}`}
                >
                  {l.row.manual === null ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => onChange(swapBase(live(), l.row.code, convert))}
                  title={`Show everything in ${l.row.code}`}
                  className="rounded p-1 text-ink-faint hover:bg-clay-wash hover:text-clay dark:text-coal-soft"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setRows(live().rows.filter((r) => r.id !== l.row.id))}
                  title="Remove"
                  className="rounded p-1 text-ink-faint hover:bg-clay-wash hover:text-clay dark:text-coal-soft"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <div className="mt-2 px-2">
          {adding ? (
            <select
              autoFocus
              defaultValue=""
              onChange={(e) => addRow(e.target.value)}
              onBlur={() => setAdding(false)}
              className="rounded border border-paper-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
            >
              <option value="" disabled>Pick a currency</option>
              {offer.map((c) => (
                <option key={c} value={c}>{c}{currencyName(c) ? ` · ${currencyName(c)}` : ''}</option>
              ))}
            </select>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 py-1 text-xs text-ink-faint hover:text-clay dark:text-coal-soft">
              <Plus className="h-3.5 w-3.5" /> Add currency
            </button>
          )}
        </div>
      )}

      {lines.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">Add a currency to compare against {normalizeCode(value.base)}.</p>}
      {fetchedAt === 0 && <p className="px-2 py-2 text-xs text-ochre">No rates cached yet. Connect once and they keep working offline.</p>}
    </div>
  );
}

function readValue(attrs: Record<string, unknown>): FxBoardData {
  const fallback = defaultFxBoard(getBaseCurrency());
  return {
    title: (attrs.title as string) || '',
    amount: typeof attrs.amount === 'number' && Number.isFinite(attrs.amount) ? attrs.amount : fallback.amount,
    base: normalizeCode((attrs.base as string) || fallback.base),
    rows: Array.isArray(attrs.rows) ? (attrs.rows as FxRow[]) : fallback.rows,
  };
}

// The widget: a thin node-view wrapper over the shared editor. Reads its attrs
// through getPos rather than the React `node` prop, so a write built after an
// await (a rate refresh landing mid-edit) can't restore a stale row list. The
// tier list learned this the expensive way.
function CurrencyView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const value = readValue(node.attrs);
  const liveValue = (): FxBoardData => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (typeof pos === 'number') {
        const n = editor.state.doc.nodeAt(pos);
        if (n && n.type.name === 'currencyBlock') return readValue(n.attrs);
      }
    } catch {
      /* fall back to the prop */
    }
    return value;
  };
  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <CurrencyEditor value={value} readLive={liveValue} onChange={(p) => updateAttributes(p)} editable={editor.isEditable} />
    </NodeViewWrapper>
  );
}

export const CurrencyBlock = Node.create({
  name: 'currencyBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: '' },
      amount: { default: 1000 },
      base: { default: '' },
      rows: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-rows') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { rows?: FxRow[] }) => ({ 'data-rows': JSON.stringify(attrs.rows || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-currency]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-currency': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CurrencyView);
  },
});
