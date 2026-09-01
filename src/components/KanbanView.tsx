import { useMemo, useRef, useState } from 'react';
import { Download, Upload, FileJson, FileDown, ClipboardList } from 'lucide-react';
import { useData, selectRowsForTable } from '../store/useData';
import type { TableData, TableRow, PresenceRecord } from '../types';
import { applyQuery, loadViewConfig, saveViewConfig, defaultViewConfig, type ViewConfig } from '../lib/tableQuery';
import { useMembers } from '../hooks/useMembers';
import { useAuth } from '../store/useAuth';
import { TableToolbar } from './TableToolbar';
import { uid, pickTagColor } from '../lib/id';
import {
  boardToBundle,
  parseKanbanBundle,
  bundleToBoard,
  bundleToUpsertPlan,
  blankKanbanBundle,
  exampleKanbanBundle,
  serializeBundle,
} from '../lib/kanbanIO';
import { detectBoardSource, parseBoard } from '../lib/importBoards';
import { Popover } from './Popover';
import { BoardView } from './TableBoardView';

// The Kanban tab is a table-backed board: each card is a row, so it inherits the
// rich row pop-out (description, labels, assignees, due date, comments, custom
// fields, checklists) and drag-between-stages. The backing table id lives on
// page.kanban; a first visit creates it (migrating any old inline cards). The
// header menu exports the whole board (columns, cards, and each card's page) as
// portable JSON, downloads a blank template or a worked example, and imports one.
//
// The import dialog also takes a Trello, Todoist or Google Keep export straight
// out of those services. lib/importBoards.ts shape-shifts one into the same
// bundle, so a foreign board lands on the proven importer rather than a second
// write path per service.

const SOURCE_LABEL = { trello: 'Trello', todoist: 'Todoist', keep: 'Google Keep' };

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function KanbanView({ pageId, editable, presence }: { pageId: string; editable: boolean; presence?: Map<string, PresenceRecord[]> }) {
  const kanban = useData((s) => s.pages[pageId]?.kanban);
  const createKanbanBoard = useData((s) => s.createKanbanBoard);
  const setTableView = useData((s) => s.setTableView);
  const tableId = kanban?.tableId ?? '';
  const table = useData((s) => (tableId ? s.tables[tableId] : undefined));
  const rowsMap = useData((s) => s.rows);
  const myId = useAuth((s) => s.user?.id ?? '');

  const allRows = table ? selectRowsForTable(rowsMap, tableId) : [];
  // Read the synced view (tables.views) so a card sort set from a column cog
  // persists and re-renders; fall back to the per-browser localStorage copy.
  // This tab *is* the board, so always coerce to a board with a stage column.
  const serverView = table?.views as ViewConfig | undefined;
  let view = table ? (serverView && serverView.type ? { ...defaultViewConfig(), ...serverView } : loadViewConfig(tableId)) : null;
  if (view && (view.type !== 'board' || !view.groupColumnId)) {
    const stage = table!.columns.find((c) => c.type === 'select');
    view = { ...view, type: 'board', groupColumnId: stage?.id };
  }
  // Apply the view's filters/sorts (with @me resolved) so the toolbar's Filter,
  // Sort and Colour controls actually act on the board. Export/count use the
  // full set; the board shows the filtered set.
  const resolvedView =
    view && view.filters?.some((f) => f.value === '@me')
      ? { ...view, filters: view.filters.map((f) => (f.value === '@me' ? { ...f, value: myId } : f)) }
      : view;
  const rows = view && table ? applyQuery(allRows, table.columns, resolvedView!) : allRows;
  // Persist a view change (the card-sort cog) the same way TableView does:
  // synced onto the table plus the localStorage fallback. Viewers can't edit.
  const onChangeView = (next: ViewConfig) => {
    if (!tableId) return;
    setTableView(tableId, next);
    saveViewConfig(tableId, next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end px-3 pb-1 sm:px-8">
        <KanbanMenu pageId={pageId} editable={editable} table={table} rows={allRows} groupColumnId={view?.groupColumnId} />
      </div>
      {/* The board controls. Rendered directly (NOT inside an overflow container)
          so the Colour / Fields / Filter dropdowns, which are absolute top-full,
          aren't clipped. The view-type switcher is hidden: the tab is a board. */}
      {editable && table && view && (
        <TableToolbar tableId={tableId} columns={table.columns} view={view} onChange={onChangeView} total={allRows.length} shown={rows.length} hideViewTabs />
      )}
      {table && view ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <BoardView tableId={tableId} table={table} rows={rows} view={view} onChange={editable ? onChangeView : undefined} presence={presence} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-ink-soft dark:text-coal-soft">No board here yet.</p>
          {editable && (
            <button
              type="button"
              onClick={() => void createKanbanBoard(pageId)}
              className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white hover:bg-clay-soft"
            >
              Start a board
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KanbanMenu({
  pageId,
  editable,
  table,
  rows,
  groupColumnId,
}: {
  pageId: string;
  editable: boolean;
  table: TableData | undefined;
  rows: TableRow[];
  groupColumnId: string | undefined;
}) {
  const members = useMembers();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportBoard = () => {
    if (!table) return;
    const bundle = boardToBundle(table, rows, groupColumnId, members);
    const safe = (table.name || 'board').replace(/[^\w-]+/g, '_');
    download(`${safe}.kanban.json`, serializeBundle(bundle), 'application/json');
    setOpen(false);
  };
  const downloadTemplate = () => {
    download('kanban-template.json', serializeBundle(blankKanbanBundle()), 'application/json');
    setOpen(false);
  };
  const downloadExample = () => {
    download('kanban-example.json', serializeBundle(exampleKanbanBundle()), 'application/json');
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper-panel/40 px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:bg-coal-line/40 dark:text-coal-soft dark:hover:bg-coal-line"
        title="Import / export board"
      >
        <Download className="h-3.5 w-3.5" /> Import / export
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} width={236} align="right">
        {table && (
          <button type="button" onClick={exportBoard} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
            <Download className="h-4 w-4 text-ink-faint" /> Export this board (JSON)
          </button>
        )}
        <button type="button" onClick={downloadTemplate} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <FileDown className="h-4 w-4 text-ink-faint" /> Download blank template
        </button>
        <button type="button" onClick={downloadExample} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <ClipboardList className="h-4 w-4 text-ink-faint" /> Download example (annotated)
        </button>
        {editable && (
          <button type="button" onClick={() => { setImporting(true); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
            <Upload className="h-4 w-4 text-ink-faint" /> Import from JSON…
          </button>
        )}
      </Popover>
      {importing && (
        <KanbanImportModal pageId={pageId} table={table} rows={rows} groupColumnId={groupColumnId} onClose={() => setImporting(false)} />
      )}
    </div>
  );
}

function KanbanImportModal({
  pageId,
  table,
  rows,
  groupColumnId,
  onClose,
}: {
  pageId: string;
  table: TableData | undefined;
  rows: TableRow[];
  groupColumnId: string | undefined;
  onClose: () => void;
}) {
  const importKanbanBoard = useData((s) => s.importKanbanBoard);
  const upsertKanbanBoard = useData((s) => s.upsertKanbanBoard);
  const members = useMembers();
  const hasBoard = !!table && table.columns.length > 0;
  const [mode, setMode] = useState<'update' | 'new'>(hasBoard ? 'update' : 'new');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Detected off the shape, not the file name, so a renamed download still works.
  // A Waypoint bundle carries `waypointKanban` and matches none of the shapes, so
  // it falls through to the native reader.
  const source = useMemo(() => (text.trim() ? detectBoardSource(text) : null), [text]);

  const onFile = async (file: File) => {
    setText(await file.text());
    setMsg('');
  };

  const doImport = async () => {
    setBusy(true);
    setMsg('');
    try {
      const read = () => {
        // Saving a Trello board page, or opening the .json url while logged out,
        // gives you the app's HTML instead of an export. "That is not valid JSON"
        // is true and useless, so name what happened and where the export lives.
        if (/^\s*<(!doctype|html|\?xml)/i.test(text)) {
          throw new Error('That is a web page, not an export. In Trello: board menu, then Print, export and share, then Export as JSON.');
        }
        if (!source) return { bundle: parseKanbanBundle(text), from: '', skipped: 0 };
        const foreign = parseBoard(text, source);
        if (!foreign.bundle) throw new Error(foreign.problem ?? 'Could not read that export.');
        return { bundle: foreign.bundle, from: SOURCE_LABEL[source], skipped: foreign.skipped };
      };
      const { bundle, from, skipped } = read();
      const tail = skipped ? `, ${skipped} skipped` : '';
      if (mode === 'update' && table) {
        const plan = bundleToUpsertPlan(
          bundle,
          { columns: table.columns, rows, groupColumnId },
          { uid, pickColor: pickTagColor, roster: members },
        );
        const id = await upsertKanbanBoard(pageId, plan);
        setBusy(false);
        if (!id) {
          setMsg('Update failed, the board could not be reached.');
          return;
        }
        setMsg(`Updated ${plan.updatedCount}, added ${plan.createdCount}${tail}.`);
      } else {
        const plan = bundleToBoard(bundle, { uid, pickColor: pickTagColor, roster: members });
        const id = await importKanbanBoard(pageId, plan);
        setBusy(false);
        if (!id) {
          setMsg('Import failed, the board could not be created.');
          return;
        }
        setMsg(`Imported ${plan.cards.length} card${plan.cards.length === 1 ? '' : 's'}${from ? ` from ${from}` : ''}${tail}.`);
      }
    } catch (err) {
      setBusy(false);
      setMsg(err instanceof Error ? err.message : 'Could not read that file.');
      return;
    }
    setTimeout(onClose, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink dark:text-coal-text">
          <FileJson className="h-4 w-4 text-clay" /> Import a board
        </h3>
        {hasBoard && (
          <div className="mb-2 flex gap-1 rounded-lg border border-paper-line p-0.5 dark:border-coal-line">
            {(['update', 'new'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${
                  mode === m
                    ? 'bg-clay text-white'
                    : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line'
                }`}
              >
                {m === 'update' ? 'Update this board' : 'New board'}
              </button>
            ))}
          </div>
        )}
        <p className="mb-2 text-xs text-ink-faint dark:text-coal-soft">
          {mode === 'update'
            ? 'Matches each card by its id (kept on export) or an exact title, edits land on the matching card and new cards are added. Nothing is deleted.'
            : 'Paste a board JSON file (or pick one), columns, cards, and each card’s page come in as a new board. A Trello, Todoist or Google Keep export drops in here too. Download the template or example from the menu to see the shape.'}
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={'{\n  "waypointKanban": 1,\n  "title": "My board",\n  "columns": [ ... ],\n  "cards": [ ... ]\n}'}
          className="w-full rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        {source && (
          <p className="mt-1 text-xs text-clay">Read as a {SOURCE_LABEL[source]} export.</p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="cursor-pointer text-xs text-clay hover:underline">
            Choose a file…
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
          <span className="flex-1 truncate text-right text-xs text-clay">{msg}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft dark:border-coal-line dark:text-coal-soft">Cancel</button>
            <button type="button" onClick={doImport} disabled={busy || !text.trim()} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-60">{busy ? 'Importing…' : 'Import'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
