import { useEffect, useMemo, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { LayoutGrid, Pencil, Trash2, Plus, Image as ImageIcon, ChevronDown, Table2 } from 'lucide-react';
import type { Column, TableData, TableRow } from '../types';
import { useData, selectRowsForTable } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import { useMembers } from '../hooks/useMembers';
import { cellText, resolveCellText, resolveLookup } from '../lib/tableQuery';
import { buildScope } from '../components/TableCell';
import { evaluateFormula, formatFormulaValue, formatValue } from '../lib/formula';
import { gridsByPage } from '../lib/grids';
import { displayTitle } from '../lib/crypto';
import { isImageIcon } from '../lib/pageIcon';
import { uploadsApi } from '../lib/api';
import { processImageFile } from '../lib/image';
import { EmojiPicker } from '../components/EmojiPicker';

// customCardBlock ("Custom count"), a generalised countdown: a card that shows the
// live value of one cell you pick from any named grid (grid -> column -> row) with
// your own caption, icon and optional prefix/suffix. Use it for a running budget
// total, a remaining count, a status, whatever a grid cell holds. Holds several at
// once. Slash: /customcount. The value resolves live from the store (and evaluates
// formula / rollup / lookup columns just like the grid), so editing the grid
// updates the card everywhere.

interface CardItem {
  id: string;
  text: string; // caption (searched via lib/search attrText, which reads item.text)
  icon: string; // emoji, or an uploaded image / inlined SVG data URL
  tableId: string;
  columnId: string;
  rowId: string;
  prefix: string;
  suffix: string;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function readItems(attrs: Record<string, unknown>): CardItem[] {
  const raw = attrs.items;
  return Array.isArray(raw) ? (raw as CardItem[]) : [];
}

// Compute what a cell shows, matching the grid: formulas are evaluated, numbers
// and rollups formatted, lookups joined, everything else read as text. This is
// why a "function" (formula) column now shows its result instead of a blank.
export function cellDisplay(
  table: TableData | undefined,
  row: TableRow | undefined,
  col: Column | undefined,
  tables: Record<string, TableData>,
  rowsMap: Record<string, TableRow>,
  members: readonly { id: string; name: string }[],
): string {
  if (!table || !row || !col) return '';
  if (col.type === 'formula') {
    const r = evaluateFormula(col.formula ?? '', buildScope(table.columns, row.cells));
    return r.ok ? formatFormulaValue(r.value, col.numberFormat) : '#ERR';
  }
  if (col.type === 'number') {
    const v = row.cells[col.id];
    return v === null || v === undefined || v === '' ? '' : formatValue(Number(v), col.numberFormat ?? 'plain');
  }
  if (col.type === 'rollup') {
    const relCol = table.columns.find((c) => c.id === col.rollupRelationColumnId);
    if (!relCol || !col.rollupTargetColumnId) return '';
    const relIds = Array.isArray(row.cells[relCol.id]) ? (row.cells[relCol.id] as string[]) : [];
    const nums: number[] = [];
    for (const rid of relIds) {
      const v = rowsMap[rid]?.cells[col.rollupTargetColumnId];
      if (typeof v === 'number') nums.push(v);
      else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) nums.push(Number(v));
    }
    const fn = col.rollupFn ?? 'sum';
    let out = 0;
    if (fn === 'count') out = relIds.length;
    else if (nums.length === 0) out = 0;
    else if (fn === 'sum') out = nums.reduce((a, b) => a + b, 0);
    else if (fn === 'avg') out = nums.reduce((a, b) => a + b, 0) / nums.length;
    else if (fn === 'min') out = Math.min(...nums);
    else out = Math.max(...nums);
    return formatValue(out, col.numberFormat ?? 'plain');
  }
  if (col.type === 'lookup') return resolveLookup(row, table.columns, col, tables, rowsMap, members);
  return cellText(row.cells[col.id] ?? null, col, members);
}

// An icon is an emoji string or an uploaded image/SVG (a URL / data URL). Images
// render contained (whole glyph, no cropped edges) per the page-icon fix.
function IconGlyph({ icon, className }: { icon: string; className: string }) {
  if (isImageIcon(icon)) return <img src={icon.trim()} alt="" className={`${className} object-contain`} />;
  return <span className="leading-none">{icon || '📊'}</span>;
}

function CustomCardView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const items = readItems(node.attrs);
  const tables = useData((s) => s.tables);
  const rowsMap = useData((s) => s.rows);
  const pages = useData((s) => s.pages);
  const currentPageId = useData((s) => s.activePageId);
  const wsId = useWorkspace((s) => s.activeWorkspaceId);
  const members = useMembers();
  const [editingId, setEditingId] = useState<string | null>(() => items.find((it) => !it.tableId)?.id ?? null);
  const [iconOpenId, setIconOpenId] = useState<string | null>(null);
  const [gridOpenId, setGridOpenId] = useState<string | null>(null);

  // Grids grouped by page (current page first), trashed pages skipped.
  const grouped = useMemo(() => gridsByPage(pages, tables, wsId ?? '', currentPageId), [pages, tables, wsId, currentPageId]);
  // tableId -> a short "where it's from" label for the picker button.
  const gridWhere = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grouped.current) m.set(g.tableId, 'On this page');
    for (const grp of grouped.others) for (const g of grp.grids) m.set(g.tableId, displayTitle(grp.pageTitle));
    return m;
  }, [grouped]);

  const write = (next: CardItem[]) => updateAttributes({ items: next });
  const patch = (id: string, p: Partial<CardItem>) => write(items.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const remove = (id: string) => {
    write(items.filter((it) => it.id !== id));
    setEditingId(null);
  };
  const add = () => {
    const it: CardItem = { id: newId(), text: '', icon: '📊', tableId: '', columnId: '', rowId: '', prefix: '', suffix: '' };
    write([...items, it]);
    setEditingId(it.id);
  };

  // A fresh block opens one editable card so /customcount is ready to fill in.
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && editable && items.length === 0) {
      seeded.current = true;
      add();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowLabel = (tableId: string, rowId: string): string => {
    const t = tables[tableId];
    const r = rowsMap[rowId];
    if (!t || !r) return 'Untitled';
    const titleCol = t.columns[0];
    return (titleCol ? cellText(r.cells[titleCol.id] ?? null, titleCol, members) : '') || 'Untitled';
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="space-y-2">
        {items.map((it) => {
          const table = tables[it.tableId];
          const row = rowsMap[it.rowId];
          const col = table?.columns.find((c) => c.id === it.columnId);
          const meta = resolveCellText(tables, rowsMap, it.tableId, it.columnId, it.rowId, members);
          const value = meta.ok ? cellDisplay(table, row, col, tables, rowsMap, members) : '';
          const tableRows = it.tableId ? selectRowsForTable(rowsMap, it.tableId) : [];
          return editingId === it.id && editable ? (
            <div key={it.id} className="rounded-xl border border-paper-line bg-paper-panel/50 p-3 dark:border-coal-line dark:bg-coal/40">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
                <LayoutGrid className="h-3.5 w-3.5 text-clay" /> Custom count
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative shrink-0" contentEditable={false}>
                  <button
                    type="button"
                    onClick={() => setIconOpenId((o) => (o === it.id ? null : it.id))}
                    title="Choose an icon"
                    className="flex h-9 w-12 items-center justify-center overflow-hidden rounded-lg border border-paper-line bg-paper text-xl hover:border-clay dark:border-coal-line dark:bg-coal-panel"
                  >
                    <IconGlyph icon={it.icon} className="h-6 w-6" />
                  </button>
                  {iconOpenId === it.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIconOpenId(null)} />
                      <div className="absolute left-0 top-11 z-50 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                        <EmojiPicker
                          onSelect={(e) => {
                            patch(it.id, { icon: e });
                            setIconOpenId(null);
                          }}
                        />
                        <label className="mt-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
                          <ImageIcon className="h-3.5 w-3.5" /> Upload an image
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const url = (await uploadsApi.upload(file)) ?? (await processImageFile(file));
                                if (url) patch(it.id, { icon: url });
                              } catch {
                                /* ignore a bad image */
                              }
                              setIconOpenId(null);
                            }}
                          />
                        </label>
                      </div>
                    </>
                  )}
                </div>
                <input
                  value={it.text}
                  onChange={(e) => patch(it.id, { text: e.target.value })}
                  placeholder="Label (e.g. Budget left)"
                  className="min-w-0 flex-1 rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
                />
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-rose-500 dark:hover:bg-coal-line"
                  title="Remove this card"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Pick the grid (custom picker: this page first, then other pages),
                  then the column + row. */}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="flex flex-col gap-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
                  Grid
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setGridOpenId((o) => (o === it.id ? null : it.id))}
                      className="flex w-full items-center gap-1 rounded-md border border-paper-line bg-paper px-1.5 py-1 text-left text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                    >
                      <span className="min-w-0 flex-1 truncate">{table ? table.name || 'Untitled table' : 'Pick a grid…'}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    </button>
                    {table && it.tableId && (
                      <span className="mt-0.5 block truncate text-[10px] text-ink-faint dark:text-coal-soft">from {gridWhere.get(it.tableId) ?? 'another page'}</span>
                    )}
                    {gridOpenId === it.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setGridOpenId(null)} />
                        <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                          {grouped.current.length === 0 && grouped.others.length === 0 && (
                            <div className="px-2 py-2 text-xs text-ink-faint dark:text-coal-soft">No grids in this workspace yet. Add a table with /table.</div>
                          )}
                          {grouped.current.length > 0 && (
                            <>
                              <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">On this page</div>
                              {grouped.current.map((g) => (
                                <GridOption key={g.tableId} name={g.tableName} active={g.tableId === it.tableId} onClick={() => { patch(it.id, { tableId: g.tableId, columnId: '', rowId: '' }); setGridOpenId(null); }} />
                              ))}
                            </>
                          )}
                          {grouped.others.map((grp) => (
                            <div key={grp.pageId}>
                              <div className="truncate px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">{displayTitle(grp.pageTitle)}</div>
                              {grp.grids.map((g) => (
                                <GridOption key={g.tableId} name={g.tableName} active={g.tableId === it.tableId} onClick={() => { patch(it.id, { tableId: g.tableId, columnId: '', rowId: '' }); setGridOpenId(null); }} />
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <label className="flex flex-col gap-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
                  Column
                  <select
                    value={it.columnId}
                    disabled={!table}
                    onChange={(e) => patch(it.id, { columnId: e.target.value })}
                    className="rounded-md border border-paper-line bg-paper px-1.5 py-1 text-sm text-ink disabled:opacity-50 dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    <option value="">Pick a column…</option>
                    {(table?.columns ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || 'Untitled'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
                  Row
                  <select
                    value={it.rowId}
                    disabled={!table}
                    onChange={(e) => patch(it.id, { rowId: e.target.value })}
                    className="rounded-md border border-paper-line bg-paper px-1.5 py-1 text-sm text-ink disabled:opacity-50 dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    <option value="">Pick a row…</option>
                    {tableRows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {rowLabel(it.tableId, r.id)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Optional text around the value, e.g. a "¥" prefix or "left" suffix. */}
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={it.prefix}
                  onChange={(e) => patch(it.id, { prefix: e.target.value })}
                  placeholder="prefix (¥)"
                  className="w-24 rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                />
                <span className="rounded bg-paper px-2 py-1 text-sm text-ink-soft dark:bg-coal dark:text-coal-soft">{meta.ok ? value || '·' : 'value'}</span>
                <input
                  value={it.suffix}
                  onChange={(e) => patch(it.id, { suffix: e.target.value })}
                  placeholder="suffix (left)"
                  className="w-24 rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                />
              </div>

              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div
              key={it.id}
              className="relative flex items-center gap-4 overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/70 to-paper-panel/40 p-4 dark:border-coal-line dark:from-clay/10 dark:to-coal/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center text-4xl leading-none">
                <IconGlyph icon={it.icon} className="h-10 w-10" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  {it.prefix && <span className="text-lg font-semibold text-clay">{it.prefix}</span>}
                  <span className="truncate font-mono text-3xl font-bold tabular-nums tracking-tight text-clay">
                    {meta.ok ? value || '·' : 'Pick a cell'}
                  </span>
                  {it.suffix && <span className="text-sm text-ink-soft dark:text-coal-soft">{it.suffix}</span>}
                </div>
                {it.text && <div className="mt-0.5 truncate text-sm font-medium text-ink dark:text-coal-text">{it.text}</div>}
                {meta.ok && (
                  <div className="mt-0.5 truncate text-[11px] text-ink-faint dark:text-coal-soft">
                    {meta.tableName} · {meta.rowName} · {meta.columnName}
                  </div>
                )}
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={() => setEditingId(it.id)}
                  className="absolute right-2 top-2 rounded-md p-1 text-ink-faint hover:bg-paper-panel hover:text-clay dark:hover:bg-coal-line"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {editable && (
          <button
            type="button"
            onClick={add}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-paper-line py-2 text-sm text-ink-faint hover:border-clay hover:text-clay dark:border-coal-line"
          >
            <Plus className="h-4 w-4" /> Add a card
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}

function GridOption({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
        active ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft' : 'text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line',
      ].join(' ')}
    >
      <Table2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}

export const CustomCardBlock = Node.create({
  name: 'customCardBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      items: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-items') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { items?: CardItem[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-custom-card]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-custom-card': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CustomCardView);
  },
});
