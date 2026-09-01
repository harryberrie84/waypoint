import { useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, CircleCheck, ArrowUpNarrowWide, ArrowDownWideNarrow, ChevronUp, ChevronDown, Settings2 } from 'lucide-react';
import { useData } from '../store/useData';
import type { Column, SelectOption, TableData, TableRow, CellValue, PresenceRecord } from '../types';
import { groupRows, sortRows, cellText, rowColor, type ViewConfig } from '../lib/tableQuery';
import { blockingPredecessors } from '../lib/deps';
import { useAuth } from '../store/useAuth';
import { useMembers } from '../hooks/useMembers';
import { useRowNavSource } from '../hooks/useRowNavSource';
import { RowCard } from './TableCard';
import { Avatar } from './TableCell';
import { Popover } from './Popover';
import { PagePresence } from './PagePresence';

// BoardView, Kanban grouped by a select column. Drag a card to another column
// to change its value; "+ New" in a column adds a card pre-set to that group.

export function BoardView({
  tableId,
  table,
  rows,
  view,
  onChange,
  presence,
}: {
  tableId: string;
  table: TableData;
  rows: TableRow[];
  view: ViewConfig;
  onChange?: (next: ViewConfig) => void;
  // rowId -> collaborators who have that card open right now (live carets)
  presence?: Map<string, PresenceRecord[]>;
}) {
  const setCell = useData((s) => s.setCell);
  const addRow = useData((s) => s.addRow);
  const moveSelectOption = useData((s) => s.moveSelectOption);
  const addSelectOption = useData((s) => s.addSelectOption);
  const removeSelectOption = useData((s) => s.removeSelectOption);
  const renameSelectOption = useData((s) => s.renameSelectOption);
  const toggleSelectOptionDone = useData((s) => s.toggleSelectOptionDone);
  const members = useMembers();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [blockPrompt, setBlockPrompt] = useState<{ rowId: string; key: string; blockers: TableRow[] } | null>(null);

  const groupCol: Column | undefined = table.columns.find(
    (c) => c.id === view.groupColumnId && (c.type === 'select' || c.type === 'person'),
  );

  // Conditional-format tint on the cards (same rules as the grid), with @me
  // resolved. A card gets a small left accent bar in its rule colour.
  const myId = useAuth((s) => s.user?.id ?? '');
  const rawRules = view.colorRules;
  const colorRules = rawRules?.some((r) => r.value === '@me') ? rawRules.map((r) => (r.value === '@me' ? { ...r, value: myId } : r)) : rawRules;

  // Sort the cards WITHIN each stage. The board hands us rows already in the
  // query order; a card sort re-orders each column's stack by one column. For a
  // select ("label") column that is its custom option order, so you rank the
  // labels once and every column falls in line. Pure (sortRows never mutates),
  // board-wide, and set from the little cog on any column header.
  const cardSortCol = view.cardSortColumnId ? table.columns.find((c) => c.id === view.cardSortColumnId) : undefined;
  const orderCards = (rs: TableRow[]) =>
    cardSortCol ? sortRows(rs, [{ id: 'cardsort', columnId: cardSortCol.id, dir: view.cardSortDir ?? 'asc' }], table.columns) : rs;

  // While a card's drawer is open, arrows walk the board: left/right change
  // stage, up/down move within one, in exactly the rendered order.
  useRowNavSource(() => (groupCol ? groupRows(rows, groupCol).map((g) => orderCards(g.rows).map((r) => r.id)) : []));

  if (!groupCol) {
    return (
      <div className="p-6 text-center text-sm text-ink-faint dark:text-coal-soft">
        Pick a <span className="font-medium">Select</span> or <span className="font-medium">Person</span> column to group
        by (top-right of the toolbar).
        <br />
        Don&rsquo;t have one? Add one in the Grid view first.
      </div>
    );
  }

  const isPerson = groupCol.type === 'person';
  const groups = groupRows(rows, groupCol);

  // Sprint points: if a number column looks like an estimate, total it per column.
  const pointsCol = table.columns.find((c) => c.type === 'number' && /point|estimate|story|size|effort/i.test(c.name));
  const sumPoints = (rs: TableRow[]) =>
    pointsCol ? rs.reduce((n, r) => n + (typeof r.cells[pointsCol.id] === 'number' ? (r.cells[pointsCol.id] as number) : 0), 0) : 0;

  // The bucket key for a person column is a user id; write it back as a `string[]`
  // cell. For a select column it's an option id (a plain string), '' = cleared.
  const valueForKey = (key: string): CellValue => (isPerson ? (key ? [key] : []) : key || null);

  // "Blocked by": a self-linking Relation column (the same one the timeline uses)
  // holds each card's predecessor row ids; a predecessor stops blocking once it
  // reaches a stage flagged "done". Enforced only for a select board that has a
  // done stage, so a plain board (or a person board) behaves exactly as before.
  const dependsCol =
    (view.dependsOnColumnId && table.columns.find((c) => c.id === view.dependsOnColumnId && c.type === 'relation' && c.relationTableId === tableId)) ||
    table.columns.find((c) => c.type === 'relation' && c.relationTableId === tableId);
  const doneOptionIds = new Set((groupCol.options ?? []).filter((o) => o.done).map((o) => o.id));
  const firstDoneId = (groupCol.options ?? []).find((o) => o.done)?.id;
  const titleCol = table.columns[0];
  const rowTitle = (r: TableRow) => (titleCol ? cellText(r.cells[titleCol.id] ?? null, titleCol, members) : '') || 'Untitled';

  const move = (rowId: string, key: string) => setCell(rowId, groupCol.id, valueForKey(key));

  const drop = (key: string) => {
    setDragOver(null);
    const rowId = pendingDragId;
    pendingDragId = null;
    if (!rowId) return;
    const row = rows.find((r) => r.id === rowId);
    // Only intercept a real stage change on an enforceable board.
    const curKey = typeof row?.cells[groupCol.id] === 'string' ? (row!.cells[groupCol.id] as string) : '';
    if (row && !isPerson && dependsCol && firstDoneId && curKey !== key) {
      const blockers = blockingPredecessors(row, rows, dependsCol.id, groupCol.id, doneOptionIds);
      if (blockers.length) {
        setBlockPrompt({ rowId, key, blockers });
        return;
      }
    }
    move(rowId, key);
  };

  const confirmBlockedMove = () => {
    if (!blockPrompt || !firstDoneId) return;
    for (const b of blockPrompt.blockers) move(b.id, firstDoneId); // complete each blocker
    move(blockPrompt.rowId, blockPrompt.key);
    setBlockPrompt(null);
  };

  return (
    <>
    <div className="flex gap-3 overflow-x-auto p-3">
      {groups.map((g) => {
        // Person buckets carry the user id as both key and label; resolve the
        // name + avatar here so groupRows stays roster-free.
        const personName = isPerson && g.key ? members.find((m) => m.id === g.key)?.name ?? 'Unknown' : '';
        return (
        <div
          key={g.key || 'none'}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(g.key);
          }}
          onDragLeave={() => setDragOver((d) => (d === g.key ? null : d))}
          onDrop={() => {
            // A stage being reordered drops onto any column to land before it; a
            // card drop falls through to the group-change handler.
            if (pendingStageId) {
              if (!isPerson && g.key && pendingStageId !== g.key) {
                moveSelectOption(tableId, groupCol.id, pendingStageId, g.key);
              }
              pendingStageId = null;
              setDragOver(null);
              return;
            }
            drop(g.key);
          }}
          className={[
            'group/col flex w-64 shrink-0 flex-col rounded-xl border p-2',
            dragOver === g.key
              ? 'border-clay bg-clay-wash/40 dark:border-clay dark:bg-clay/10'
              : 'border-paper-line bg-paper-panel/40 dark:border-coal-line dark:bg-coal/30',
          ].join(' ')}
        >
          <div className="mb-2 flex items-center gap-1 px-1">
            {!isPerson && g.key && (
              <span
                draggable
                onDragStart={() => {
                  pendingStageId = g.key;
                }}
                onDragEnd={() => {
                  pendingStageId = null;
                }}
                className="shrink-0 cursor-grab text-ink-faint opacity-0 active:cursor-grabbing group-hover/col:opacity-100 dark:text-coal-soft"
                title="Drag to reorder this stage"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            )}
            {isPerson && g.key ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium text-ink dark:text-coal-text">
                <Avatar id={g.key} name={personName} />
                {personName}
              </span>
            ) : g.key ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                {g.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />}
                <input
                  value={g.label}
                  onChange={(e) => renameSelectOption(tableId, groupCol.id, g.key, e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xs font-medium text-ink outline-none dark:text-coal-text"
                />
              </span>
            ) : (
              <span className="min-w-0 flex-1 text-xs font-medium text-ink-faint dark:text-coal-soft">{g.label}</span>
            )}
            <span className="shrink-0 text-[11px] text-ink-faint dark:text-coal-soft">{g.rows.length}</span>
            {pointsCol && sumPoints(g.rows) > 0 && (
              <span
                className="shrink-0 rounded bg-paper px-1 text-[10px] font-medium text-ink-soft dark:bg-coal dark:text-coal-soft"
                title={`${pointsCol.name} in this stage`}
              >
                {sumPoints(g.rows)} pt
              </span>
            )}
            <CardSortCog tableId={tableId} table={table} view={view} onChange={onChange} />
            {!isPerson && g.key && (
              (() => {
                const done = groupCol.options?.some((o) => o.id === g.key && o.done) ?? false;
                return (
                  <button
                    type="button"
                    onClick={() => toggleSelectOptionDone(tableId, groupCol.id, g.key)}
                    title={done ? 'Done stage: its cards drop off Home. Click to undo.' : 'Mark this stage as done (its cards leave Home)'}
                    className={[
                      'shrink-0 rounded p-0.5',
                      done
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-ink-faint opacity-0 hover:bg-paper hover:text-emerald-600 group-hover/col:opacity-100 dark:hover:bg-coal',
                    ].join(' ')}
                  >
                    <CircleCheck className="h-3 w-3" />
                  </button>
                );
              })()
            )}
            {!isPerson && g.key && (
              <button
                type="button"
                onClick={() => removeSelectOption(tableId, groupCol.id, g.key)}
                title="Delete stage"
                className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 hover:bg-rose-500/10 hover:text-rose-500 group-hover/col:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {orderCards(g.rows).map((row) => {
              const here = presence?.get(row.id);
              const tint = rowColor(row.cells, colorRules);
              return (
                <div key={row.id} className="relative">
                  {tint && <span className="absolute bottom-1 left-0 top-1 z-10 w-1 rounded-full" style={{ background: tint }} />}
                  <RowCard
                    tableId={tableId}
                    columns={table.columns}
                    row={row}
                    excludeColumnId={groupCol.id}
                    draggable
                    onDragStart={() => {
                      pendingDragId = row.id;
                    }}
                  />
                  {here && here.length > 0 && (
                    <div className="absolute -right-1 -top-1 z-10">
                      <PagePresence people={here} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void addRow(tableId, g.key ? { [groupCol.id]: valueForKey(g.key) } : undefined)}
            className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
        );
      })}

      {/* Add a new stage (a new option on the select the board groups by). */}
      {!isPerson && (
        <button
          type="button"
          onClick={() => addSelectOption(tableId, groupCol.id, 'New stage')}
          className="flex h-min w-56 shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-paper-line px-3 py-2 text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
        >
          <Plus className="h-4 w-4" /> Add stage
        </button>
      )}
    </div>

    {blockPrompt && (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/40 p-4" onMouseDown={() => setBlockPrompt(null)}>
        <div className="w-full max-w-sm rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
          <h3 className="mb-1 text-sm font-semibold text-ink dark:text-coal-text">This task is blocked</h3>
          <p className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
            It&rsquo;s waiting on {blockPrompt.blockers.length === 1 ? 'a task that is not' : 'tasks that are not'} done yet:
          </p>
          <ul className="mb-3 max-h-40 space-y-1 overflow-auto">
            {blockPrompt.blockers.map((b) => (
              <li key={b.id} className="truncate rounded-md bg-paper-panel px-2 py-1 text-xs text-ink dark:bg-coal-line dark:text-coal-text">
                {rowTitle(b)}
              </li>
            ))}
          </ul>
          <p className="mb-3 text-xs text-ink-faint dark:text-coal-soft">
            Moving it will mark {blockPrompt.blockers.length === 1 ? 'that task' : 'those tasks'} done first. Continue?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setBlockPrompt(null)}
              className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft dark:border-coal-line dark:text-coal-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmBlockedMove}
              className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90"
            >
              Complete &amp; move
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// The little cog on each column header: choose how the cards inside every stage
// are ordered, and (for a "label" column) drag its labels into a custom order to
// sort by. Board-wide, so any column's cog edits the same setting; it just lives
// where you are looking, on the cards. The whole thing writes only to the view
// config and to the guarded option-reorder path, so it never risks card data.
const CARD_SORTABLE = new Set(['select', 'multiselect', 'number', 'formula', 'date', 'datetime', 'reminder', 'text', 'url', 'checkbox']);

function CardSortCog({
  tableId,
  table,
  view,
  onChange,
}: {
  tableId: string;
  table: TableData;
  view: ViewConfig;
  onChange?: (next: ViewConfig) => void;
}) {
  const moveSelectOption = useData((s) => s.moveSelectOption);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // "Labels" (select) first, since that is the axis the board is usually about;
  // then the other ordered types. onChange missing (a read-only embed) hides it.
  const sortable = table.columns.filter((c) => CARD_SORTABLE.has(c.type));
  const sortCol = view.cardSortColumnId ? table.columns.find((c) => c.id === view.cardSortColumnId) : undefined;
  const dir = view.cardSortDir ?? 'asc';
  const active = !!sortCol;
  if (!onChange || sortable.length === 0) return null;

  const set = (patch: Partial<ViewConfig>) => onChange({ ...view, ...patch });

  // Reorder one label option (its position is the sort order). moveSelectOption
  // inserts the option before `beforeId`, or at the end when that is null.
  const bump = (opts: SelectOption[], i: number, delta: number) => {
    const j = i + delta;
    if (!sortCol || j < 0 || j >= opts.length) return;
    const beforeId = delta < 0 ? opts[j].id : opts[j + 1]?.id ?? null;
    moveSelectOption(tableId, sortCol.id, opts[i].id, beforeId);
  };

  const opts = sortCol && (sortCol.type === 'select' || sortCol.type === 'multiselect') ? sortCol.options ?? [] : [];

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={active ? `Cards sorted by ${sortCol!.name} (${dir === 'asc' ? 'ascending' : 'descending'}). Click to change.` : 'Sort the cards in this board'}
        className={[
          'shrink-0 rounded p-0.5',
          active
            ? 'text-clay'
            : 'text-ink-faint hover:bg-paper hover:text-ink-soft dark:hover:bg-coal',
        ].join(' ')}
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={244} align="right">
        <div className="px-1.5 pb-1 pt-1 text-[11px] font-medium text-ink-faint dark:text-coal-soft">Sort cards in every stage</div>
        <select
          value={view.cardSortColumnId ?? ''}
          onChange={(e) => set({ cardSortColumnId: e.target.value || undefined })}
          className="mb-1 w-full rounded border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
        >
          <option value="">Default order</option>
          {sortable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {active && (
          <div className="mb-1 flex gap-1">
            {(['asc', 'desc'] as const).map((d) => {
              const on = dir === d;
              const Icon = d === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => set({ cardSortDir: d })}
                  className={[
                    'flex flex-1 items-center justify-center gap-1 rounded border px-1.5 py-1 text-[11px]',
                    on
                      ? 'border-clay bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
                      : 'border-paper-line text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line',
                  ].join(' ')}
                >
                  <Icon className="h-3 w-3" />
                  {d === 'asc' ? 'A→Z' : 'Z→A'}
                </button>
              );
            })}
          </div>
        )}

        {opts.length > 0 && (
          <>
            <div className="px-1.5 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-ink-faint dark:text-coal-soft">
              Custom label order {dir === 'asc' ? '(top first)' : '(bottom first)'}
            </div>
            <div className="space-y-0.5">
              {opts.map((o, i) => (
                <div key={o.id} className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-ink dark:text-coal-text">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
                  <span className="min-w-0 flex-1 truncate">{o.label || 'Untitled'}</span>
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => bump(opts, i, -1)}
                    title="Move up"
                    className="shrink-0 rounded p-0.5 text-ink-faint hover:bg-paper-panel hover:text-ink disabled:opacity-30 dark:hover:bg-coal-line dark:hover:text-coal-text"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={i === opts.length - 1}
                    onClick={() => bump(opts, i, 1)}
                    title="Move down"
                    className="shrink-0 rounded p-0.5 text-ink-faint hover:bg-paper-panel hover:text-ink disabled:opacity-30 dark:hover:bg-coal-line dark:hover:text-coal-text"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </Popover>
    </>
  );
}

// Module-scoped handoff for the dragged row id (HTML5 DnD dataTransfer is
// awkward with React re-renders; a tiny module variable is simpler and safe
// here because only one drag happens at a time).
let pendingDragId: string | null = null;
// Module-scoped handoff for a dragged stage (column header) being reordered.
let pendingStageId: string | null = null;
