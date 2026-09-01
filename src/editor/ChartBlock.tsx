import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { PieChart, BarChart3, BarChartHorizontal, Hash, Plus, X, Settings2, Database } from 'lucide-react';
import { TAG_COLORS } from '../lib/id';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { cellText } from '../lib/tableQuery';

// chartBlock, a small hand-rolled chart (SVG, no dependency): donut, vertical or
// horizontal bars, or a single big number. Data is entered by hand as label/value
// rows, so a chart works without wiring it to a table.

type ChartKind = 'donut' | 'barv' | 'barh' | 'number';
interface Point {
  label: string;
  value: number;
  color: string;
}

const KINDS: { kind: ChartKind; label: string; Icon: typeof PieChart }[] = [
  { kind: 'donut', label: 'Donut', Icon: PieChart },
  { kind: 'barv', label: 'Bars', Icon: BarChart3 },
  { kind: 'barh', label: 'Rows', Icon: BarChartHorizontal },
  { kind: 'number', label: 'Number', Icon: Hash },
];

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0');

function readData(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d, i) => {
    const p = d as Partial<Point>;
    return {
      label: typeof p.label === 'string' ? p.label : '',
      value: typeof p.value === 'number' ? p.value : Number(p.value) || 0,
      color: typeof p.color === 'string' && p.color ? p.color : TAG_COLORS[i % TAG_COLORS.length],
    };
  });
}

function Donut({ data, total }: { data: Point[]; total: number }) {
  const R = 52;
  const W = 22;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0">
      <g transform="rotate(-90 70 70)">
        <circle cx={70} cy={70} r={R} fill="none" stroke="currentColor" strokeWidth={W} className="text-paper-line dark:text-coal-line" />
        {total > 0 &&
          data.map((d, i) => {
            const len = (d.value / total) * C;
            const seg = (
              <circle
                key={i}
                cx={70}
                cy={70}
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth={W}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return seg;
          })}
      </g>
      <text x={70} y={66} textAnchor="middle" className="fill-ink text-[18px] font-bold dark:fill-coal-text">
        {fmt(total)}
      </text>
      <text x={70} y={84} textAnchor="middle" className="fill-ink-faint text-[10px] dark:fill-coal-soft">
        total
      </text>
    </svg>
  );
}

function ChartView({ node, updateAttributes, editor }: NodeViewProps) {
  const kind = (node.attrs.kind as ChartKind) || 'donut';
  const title = (node.attrs.title as string) || '';
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);

  // Live source: when a table + columns are chosen, the chart is computed from
  // that table's rows and updates as the data changes; otherwise it's manual.
  const tableId = (node.attrs.tableId as string) || '';
  const labelCol = (node.attrs.labelCol as string) || '';
  const valueCol = (node.attrs.valueCol as string) || '';
  const tables = useWorkspaceTables();
  const allRows = useData((s) => s.rows);
  const sourceTable = tableId ? tables.find((t) => t.id === tableId) : undefined;

  const live = (() => {
    if (!sourceTable || !labelCol || !valueCol) return null;
    const labelColumn = sourceTable.columns.find((c) => c.id === labelCol);
    if (!labelColumn) return null;
    const groups = new Map<string, number>();
    for (const r of Object.values(allRows)) {
      if (r.table !== sourceTable.id) continue;
      const label = cellText(r.cells[labelCol] ?? null, labelColumn) || '(empty)';
      const v = Number(r.cells[valueCol]) || 0;
      groups.set(label, (groups.get(label) ?? 0) + v);
    }
    return [...groups.entries()].map(([label, value], i) => ({ label, value, color: TAG_COLORS[i % TAG_COLORS.length] }));
  })();

  const data = live ?? readData(node.attrs.data);

  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(1, ...data.map((d) => d.value));

  const setData = (next: Point[]) => updateAttributes({ data: next });
  const addRow = () =>
    setData([...data, { label: `Item ${data.length + 1}`, value: 0, color: TAG_COLORS[data.length % TAG_COLORS.length] }]);
  const patchRow = (i: number, patch: Partial<Point>) => setData(data.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const removeRow = (i: number) => setData(data.filter((_, j) => j !== i));

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="rounded-xl border border-paper-line bg-paper-panel/40 p-4 dark:border-coal-line dark:bg-coal/40">
        <div className="mb-3 flex items-center gap-2">
          {editable ? (
            <input
              value={title}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              placeholder="Chart title"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text dark:placeholder:text-coal-soft"
            />
          ) : (
            <div className="min-w-0 flex-1 text-sm font-semibold text-ink dark:text-coal-text">{title || 'Chart'}</div>
          )}
          {editable && (
            <>
              <div className="flex items-center gap-0.5 rounded-lg border border-paper-line p-0.5 dark:border-coal-line">
                {KINDS.map(({ kind: k, label, Icon }) => (
                  <button
                    key={k}
                    type="button"
                    title={label}
                    onClick={() => updateAttributes({ kind: k })}
                    className={`rounded-md p-1 ${kind === k ? 'bg-clay text-white' : 'text-ink-faint hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line'}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                title="Edit data"
                className={`rounded-md p-1.5 ${editing ? 'bg-clay-wash text-clay dark:bg-clay/15' : 'text-ink-faint hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line'}`}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* The chart itself. */}
        {kind === 'number' ? (
          <div className="py-2">
            <div className="text-4xl font-bold tabular-nums tracking-tight text-clay">{fmt(total)}</div>
            <div className="mt-1 text-sm text-ink-soft dark:text-coal-soft">{title || 'Total'}</div>
          </div>
        ) : kind === 'donut' ? (
          <div className="flex items-center gap-5">
            <Donut data={data} total={total} />
            <div className="min-w-0 flex-1 space-y-1">
              {data.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
                  <span className="min-w-0 flex-1 truncate text-ink-soft dark:text-coal-soft">{d.label || '-'}</span>
                  <span className="shrink-0 font-medium tabular-nums text-ink dark:text-coal-text">{fmt(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : kind === 'barv' ? (
          <div>
            {/* Bars in a fixed-height row so the percentage heights resolve. */}
            <div className="flex h-44 items-end gap-2">
              {data.map((d, i) => (
                <div key={i} className="flex h-full min-w-0 flex-1 items-end">
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${max > 0 ? (d.value / max) * 100 : 0}%`, backgroundColor: d.color, minHeight: d.value > 0 ? 2 : 0 }}
                    title={`${d.label}: ${fmt(d.value)}`}
                  />
                </div>
              ))}
            </div>
            {/* Labels aligned under each bar. */}
            <div className="mt-1 flex gap-2">
              {data.map((d, i) => (
                <span key={i} className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-faint dark:text-coal-soft">
                  {d.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-right text-[11px] text-ink-faint dark:text-coal-soft">{d.label}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-paper-line/50 dark:bg-coal-line/50">
                  <div
                    className="h-full rounded"
                    style={{ width: `${(d.value / max) * 100}%`, backgroundColor: d.color }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-[11px] font-medium tabular-nums text-ink dark:text-coal-text">{fmt(d.value)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Data editor. */}
        {editing && editable && (
          <div className="mt-3 space-y-2 border-t border-paper-line pt-3 dark:border-coal-line">
            {/* Live source picker. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Database className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
              <select
                value={tableId}
                onChange={(e) => updateAttributes({ tableId: e.target.value, labelCol: '', valueCol: '' })}
                className="rounded border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                <option value="">Manual data</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || 'Untitled table'}
                  </option>
                ))}
              </select>
              {sourceTable && (
                <>
                  <select
                    value={labelCol}
                    onChange={(e) => updateAttributes({ labelCol: e.target.value })}
                    className="rounded border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    <option value="">Label by…</option>
                    {sourceTable.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={valueCol}
                    onChange={(e) => updateAttributes({ valueCol: e.target.value })}
                    className="rounded border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    <option value="">Value (number)…</option>
                    {sourceTable.columns
                      .filter((c) => c.type === 'number' || c.type === 'formula')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </>
              )}
            </div>
            {live && (
              <p className="text-[11px] text-ink-faint dark:text-coal-soft">Live from {sourceTable?.name || 'table'}, updates with the data.</p>
            )}
            {/* Manual rows (only when there's no live source). */}
            {!live &&
              data.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={d.color}
                  onChange={(e) => patchRow(i, { color: e.target.value })}
                  className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <input
                  value={d.label}
                  onChange={(e) => patchRow(i, { label: e.target.value })}
                  placeholder="Label"
                  className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-2 py-1 text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                />
                <input
                  value={String(d.value)}
                  onChange={(e) => patchRow(i, { value: Number(e.target.value.replace(',', '.')) || 0 })}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-20 shrink-0 rounded border border-paper-line bg-paper px-2 py-1 text-right text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="shrink-0 rounded p-1 text-ink-faint hover:bg-rose-500/10 hover:text-rose-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {!live && (
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
              >
                <Plus className="h-3.5 w-3.5" /> Add row
              </button>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const ChartBlock = Node.create({
  name: 'chartBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'donut' },
      title: { default: '' },
      // Array attr, kept in the TipTap JSON; don't try to serialise it to a DOM
      // attribute (it would render as "[object Object]").
      data: { default: [], renderHTML: () => ({}) },
      // Live source: a table id plus the label and value column ids. Empty means
      // manual data.
      tableId: { default: '' },
      labelCol: { default: '' },
      valueCol: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-chart]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-chart': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartView);
  },
});

// A few sample points so a freshly inserted chart renders something.
export function sampleChartData(): Point[] {
  return [
    { label: 'Lodging', value: 40, color: TAG_COLORS[0] },
    { label: 'Food', value: 25, color: TAG_COLORS[3] },
    { label: 'Travel', value: 20, color: TAG_COLORS[5] },
    { label: 'Other', value: 15, color: TAG_COLORS[7] },
  ];
}
