import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Maximize2, Smile, Image as ImageIcon, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { useData } from '../store/useData';
import type { ColumnType } from '../types';
import { Editor } from './Editor';
import { Cell, ChecklistInline, TYPE_META, buildScope } from './TableCell';
import { CommentsPanel } from './CommentsPanel';
import { RowReactions } from './RowReactions';
import { EmojiPicker } from './EmojiPicker';
import { titleColumn, rowIcon, ROW_ICON_KEY, geoOf } from '../lib/tableQuery';
import { AddToCalendarButton } from './AddToCalendarButton';
import type { CalEvent } from '../lib/ics';
import { navTarget, type NavDir } from '../lib/rowNav';
import { isImageIcon } from '../lib/pageIcon';
import { backlinksFor } from '../lib/backlinks';
import { uploadsApi } from '../lib/api';
import { processImageFile } from '../lib/image';

// RowDetail, opens a single database row "as a page": the title, its
// properties (the columns, a.k.a. "variables"), then a normal rich-text body
// underneath. Shared by every view (grid / board / gallery / calendar).

const KEY_DIR: Record<string, NavDir> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

// The header nav buttons, in reading order: stage/day first, then the items.
const NAV_BUTTONS = [
  { dir: 'left', Icon: ChevronLeft, label: 'Previous stage or day (←)' },
  { dir: 'right', Icon: ChevronRight, label: 'Next stage or day (→)' },
  { dir: 'up', Icon: ChevronUp, label: 'Previous item (↑)' },
  { dir: 'down', Icon: ChevronDown, label: 'Next item (↓)' },
] as const;

export function RowDetail() {
  const openRowId = useData((s) => s.openRowId);
  const row = useData((s) => (openRowId ? s.rows[openRowId] : null));
  const table = useData((s) => (row ? s.tables[row.table] : null));
  const closeRow = useData((s) => s.closeRow);
  const setCell = useData((s) => s.setCell);
  const setRowContent = useData((s) => s.setRowContent);
  const deleteRow = useData((s) => s.deleteRow);
  const addColumn = useData((s) => s.addColumn);
  const updateColumn = useData((s) => s.updateColumn);
  const addSubRow = useData((s) => s.addSubRow);
  const openRow = useData((s) => s.openRow);
  const allRows = useData((s) => s.rows);
  const allTables = useData((s) => s.tables);
  const activePageId = useData((s) => s.activePageId);

  const [addOpen, setAddOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);

  // Esc closes; arrows hop to a neighbouring row when the view underneath
  // (board/calendar) has registered its order. Inert while a field or the body
  // editor owns the keyboard, so arrows still move the caret when typing.
  useEffect(() => {
    if (!openRowId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRow();
        return;
      }
      const dir = KEY_DIR[e.key];
      if (!dir || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const t = navTarget(openRowId, dir);
      if (!t) return;
      e.preventDefault();
      openRow(t.id);
      t.onOpen?.(t.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openRowId, closeRow, openRow]);

  if (!openRowId || !row || !table) return null;

  const title = titleColumn(table.columns);
  const icon = rowIcon(row);
  const scope = buildScope(table.columns, row.cells);
  const properties = table.columns.filter((c) => c.id !== title?.id);
  const children = Object.values(allRows)
    .filter((r) => r.parent === row.id)
    .sort((a, b) => a.position - b.position);
  const backlinks = backlinksFor(allTables, allRows, row.id);
  const childLabel = (r: typeof row) => (title ? String(r.cells[title.id] ?? '') : '') || 'Untitled';

  // Neighbouring rows in the view underneath (board stages / calendar days).
  // Empty on a view with no registered order (a grid), which hides the group.
  const nav = {
    left: navTarget(row.id, 'left'),
    right: navTarget(row.id, 'right'),
    up: navTarget(row.id, 'up'),
    down: navTarget(row.id, 'down'),
  };
  const hasNav = !!(nav.left || nav.right || nav.up || nav.down);

  // Add-to-calendar: this row is calendar-worthy the moment it has a title AND at
  // least one date/datetime property with a value (one event per dated column). The
  // button hides itself when either is missing.
  const titleVal = title ? String(row.cells[title.id] ?? '').trim() : '';
  const placeCol = table.columns.find((c) => c.type === 'place');
  const placeName = placeCol ? geoOf(row.cells[placeCol.id] ?? null)?.name : undefined;
  const calEvents: CalEvent[] = titleVal
    ? table.columns
        .filter((c) => c.type === 'date' || c.type === 'datetime')
        .flatMap((c) => {
          const v = row.cells[c.id];
          if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return [];
          return [{ title: titleVal, startIso: v, location: placeName || undefined, description: `${table.name || 'Entry'} · ${c.name}`, uid: `${row.id}-${c.id}` }];
        })
    : [];

  return (
    <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-coal/40 p-4 backdrop-blur-sm sm:p-8">
      <div className="absolute inset-0" onMouseDown={closeRow} />
      <div className="relative z-10 my-4 w-full max-w-2xl rounded-2xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel">
        {/* top bar */}
        <div className="flex items-center justify-between border-b border-paper-line px-4 py-2 dark:border-coal-line">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Maximize2 className="h-3.5 w-3.5" /> {table.name || 'Entry'}
          </span>
          <div className="flex items-center gap-1">
            {hasNav && (
              <>
                {NAV_BUTTONS.map(({ dir, Icon, label }) => (
                  <button
                    key={dir}
                    type="button"
                    disabled={!nav[dir]}
                    onClick={() => {
                      const t = nav[dir];
                      if (!t) return;
                      openRow(t.id);
                      t.onOpen?.(t.id);
                    }}
                    className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-coal-line dark:hover:text-coal-text"
                    title={label}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
                <span className="mx-0.5 h-4 w-px shrink-0 bg-paper-line dark:bg-coal-line" />
              </>
            )}
            {calEvents.length > 0 && <AddToCalendarButton events={calEvents} calName={titleVal} compact align="right" />}
            <button
              type="button"
              onClick={() => {
                deleteRow(row.id);
                closeRow();
              }}
              className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line"
              title="Delete entry"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={closeRow}
              className="rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6">
          {/* Icon */}
          <div className="relative mb-1 inline-block">
            <button
              type="button"
              onClick={() => setIconOpen((o) => !o)}
              className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-paper text-4xl leading-none hover:bg-paper-panel dark:bg-coal-panel dark:hover:bg-coal-line"
              title="Set an icon"
            >
              {icon ? (
                isImageIcon(icon) ? (
                  <img src={icon} alt="" className="h-full w-full object-contain" />
                ) : (
                  icon
                )
              ) : (
                <Smile className="h-6 w-6 text-ink-faint" />
              )}
            </button>
            {iconOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                <EmojiPicker
                  onSelect={(em) => {
                    setCell(row.id, ROW_ICON_KEY, em);
                    setIconOpen(false);
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
                        if (url) setCell(row.id, ROW_ICON_KEY, url);
                      } catch {
                        /* ignore a bad image */
                      }
                      setIconOpen(false);
                    }}
                  />
                </label>
                {icon && (
                  <button
                    type="button"
                    onClick={() => {
                      setCell(row.id, ROW_ICON_KEY, '');
                      setIconOpen(false);
                    }}
                    className="mt-0.5 w-full rounded px-2 py-1 text-left text-xs text-ink-faint hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
                  >
                    Remove icon
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Title */}
          {title ? (
            <input
              value={typeof row.cells[title.id] === 'string' ? (row.cells[title.id] as string) : ''}
              onChange={(e) => setCell(row.id, title.id, e.target.value)}
              placeholder="Untitled"
              className="mb-4 w-full bg-transparent font-display text-3xl font-bold text-ink outline-none placeholder:text-ink-faint/50 dark:text-coal-text"
            />
          ) : (
            <h2 className="mb-4 font-display text-3xl font-bold text-ink-faint">Entry</h2>
          )}

          {/* Properties ("variables") */}
          <div className="mb-5 space-y-1.5">
            {properties.map((col) => {
              const Icon = TYPE_META[col.type].icon;
              return (
                <div key={col.id} className="flex items-start gap-2">
                  <div className="flex w-28 shrink-0 items-center gap-1.5 pt-1.5 text-xs text-ink-faint dark:text-coal-soft sm:w-36">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <input
                      value={col.name}
                      onChange={(e) => updateColumn(table.id, col.id, { name: e.target.value })}
                      placeholder="Name"
                      title="Rename this property"
                      className="min-w-0 flex-1 bg-transparent text-xs text-ink-faint outline-none focus:text-ink dark:text-coal-soft dark:focus:text-coal-text"
                    />
                  </div>
                  {col.type === 'checklist' ? (
                    // A checklist gets the full-width inline editor here, not
                    // the compact popover: the drawer is where you work in it.
                    <div className="min-w-0 flex-1">
                      <ChecklistInline rowId={row.id} column={col} value={row.cells[col.id] ?? null} />
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 rounded-md hover:bg-paper-panel/60 dark:hover:bg-coal-line/40">
                      <Cell tableId={table.id} rowId={row.id} column={col} value={row.cells[col.id] ?? null} scope={scope} />
                    </div>
                  )}
                </div>
              );
            })}

            <div className="relative pt-1">
              <button
                type="button"
                onClick={() => setAddOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-ink-faint hover:text-clay dark:text-coal-soft"
              >
                <Plus className="h-3.5 w-3.5" /> Add a property
              </button>
              {addOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-paper-line bg-paper p-1 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                  {(Object.keys(TYPE_META) as ColumnType[]).map((t) => {
                    const Icon = TYPE_META[t].icon;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          addColumn(table.id, t);
                          setAddOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                      >
                        <Icon className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
                        {TYPE_META[t].label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Reactions, vote on this entry */}
          <div className="mb-4 flex items-center gap-2">
            <span className="w-28 shrink-0 text-xs text-ink-faint dark:text-coal-soft sm:w-36">Reactions</span>
            <RowReactions rowId={row.id} variant="detail" />
          </div>

          <div className="mb-3 border-t border-paper-line dark:border-coal-line" />

          {/* Sub-items, nested rows under this one */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-faint dark:text-coal-soft">
                Sub-items{children.length > 0 ? ` · ${children.length}` : ''}
              </span>
              <button
                type="button"
                onClick={() => void addSubRow(row.id)}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-faint hover:text-clay dark:text-coal-soft"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            {children.length > 0 && (
              <div className="space-y-0.5">
                {children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openRow(c.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-paper-line px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:border-coal-line dark:text-coal-text dark:hover:bg-coal-line"
                  >
                    <Maximize2 className="h-3 w-3 shrink-0 text-ink-faint dark:text-coal-soft" />
                    <span className="truncate">{childLabel(c)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>


          {/* Linked from, rows elsewhere that point a relation at this one */}
          {backlinks.length > 0 && (
            <div className="mb-4">
              <span className="text-xs font-medium text-ink-faint dark:text-coal-soft">Linked from</span>
              <div className="mt-1.5 space-y-2">
                {backlinks.map((g) => (
                  <div key={g.tableId}>
                    <span className="text-[11px] uppercase tracking-wide text-ink-faint dark:text-coal-soft">{g.tableName}</span>
                    <div className="mt-0.5 space-y-0.5">
                      {g.refs.map((ref) => (
                        <button
                          key={ref.rowId}
                          type="button"
                          onClick={() => openRow(ref.rowId)}
                          className="flex w-full items-center gap-2 rounded-md border border-paper-line px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:border-coal-line dark:text-coal-text dark:hover:bg-coal-line"
                          title={`via ${ref.columnName}`}
                        >
                          <Maximize2 className="h-3 w-3 shrink-0 text-ink-faint dark:text-coal-soft" />
                          <span className="truncate">{ref.title}</span>
                          <span className="ml-auto shrink-0 truncate text-[11px] text-ink-faint dark:text-coal-soft">{ref.columnName}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}


          {/* Page body, the regular Notion-style content. While the body is still
              ciphertext (encrypted workspace, vault not open yet) it renders as a
              read-only notice instead of an empty editor: an editable empty doc here
              reports a change on mount and would save that emptiness over the body.
              setRowContent refuses it too, this is the visible half of that guard. */}
          {row.contentEnc ? (
            <div className="rounded-xl border border-paper-line px-4 py-6 text-sm text-ink-soft dark:border-coal-line">
              This entry's notes are encrypted. Unlock your vault to read and edit them.
            </div>
          ) : (
            <Editor
              key={row.id}
              content={(row.content as object) ?? null}
              editable
              onChange={(json) => setRowContent(row.id, json)}
            />
          )}

          {/* Row discussion, argue about this specific entry */}
          <div className="mt-5 h-72 overflow-hidden rounded-xl border border-paper-line dark:border-coal-line">
            <CommentsPanel pageId={activePageId ?? ''} rowId={row.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
