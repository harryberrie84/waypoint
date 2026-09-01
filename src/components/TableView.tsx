import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Trash2, Tag, ChevronDown, ChevronRight, Maximize2, Download, Upload, FileText, Copy, CalendarPlus, Link2, Unlink, AlertTriangle, ArrowLeft, ArrowRight, Share2, RefreshCw, Globe } from 'lucide-react';
import { findClashes } from '../lib/clash';
import { useData, selectRowsForTable } from '../store/useData';
import { toastWithAction } from '../store/useToast';
import { confirmAsk } from '../store/useConfirm';
import { useWorkspace } from '../store/useWorkspace';
import { useWorkspaceTables } from '../hooks/useScoped';
import { useAuth } from '../store/useAuth';
import { cellDisplay } from '../editor/CustomCardBlock';
import { bakeSharedTable } from '../lib/sharedTable';
import { useMembers } from '../hooks/useMembers';
import type { Column, ColumnType, CellValue, TableData, TableRow, AggregationKind } from '../types';
import { evaluateFormula, formatValue } from '../lib/formula';
import { shortId } from '../lib/id';
import { Cell, TYPE_META, buildScope as scopeFor, coerceNumber } from './TableCell';
import { applyQuery, loadViewConfig, saveViewConfig, defaultViewConfig, buildRowTree, titleColumn, firstPlaceColumn, packedStat, rowIcon, rowColor, type ViewConfig, type ColorRule } from '../lib/tableQuery';
import { isImageIcon } from '../lib/pageIcon';
import { planUrlImport } from '../lib/urlImport';
import { fetchLinkMeta } from '../lib/linkMeta';
import { searchPois, poiToGeo } from '../lib/poi';
import { tableToCSV, tableToMarkdown, parseDelimited } from '../lib/csv';
import { tableToICS } from '../lib/ics';
import { subscribeFx, fxVersion } from '../lib/fx';
import { subscribeRefs, refsVersion, publishRef, clearRef } from '../lib/refRegistry';
import { ActionEditor } from './ActionEditor';
import { AutomationsButton } from './AutomationsPanel';
import { TableToolbar } from './TableToolbar';
import { Popover } from './Popover';
import { BoardView } from './TableBoardView';
import { GalleryView } from './TableGalleryView';
import { CalendarView } from './TableCalendarView';
import { ScheduleView } from './TableScheduleView';
import { TimelineView } from './TableTimelineView';
import { MapView } from './TableMapView';
import { RouteView } from './TableRouteView';

// ---------------------------------------------------------------------------
// TableView, the relational database block. Orchestrates the per-table view
// config (grid / board / gallery / calendar + filter / sort / group) and
// renders the active view over the queried rows.
// ---------------------------------------------------------------------------

// A table can be embedded on several pages. By default every embed shares the
// table's own view config (tables.views). A "linked view" instead carries its
// own ViewConfig in the embed node's attrs, same rows, independent filters/view.
// These controls let an embed write to that per-instance config and spawn a
// linked copy, without touching the shared table.
export interface EmbedViewControls {
  viewConfig: ViewConfig | null; // this instance's config; null = shares tables.views
  editable: boolean; // whether the surrounding page may be edited (hides the chrome otherwise)
  setViewConfig: (cfg: ViewConfig | null) => void; // null clears back to the shared view
  duplicateLinked: (cfg: ViewConfig) => void; // insert a sibling embed of the same table
  deleteEmbed?: () => void; // remove this embed from the page (asks first); table rows are kept
}

const cloneView = (v: ViewConfig): ViewConfig => JSON.parse(JSON.stringify(v));

export function TableView({ tableId, embed }: { tableId: string; embed?: EmbedViewControls }) {
  const table = useData((s) => s.tables[tableId]);
  const rowsMap = useData((s) => s.rows);
  const renameTable = useData((s) => s.renameTable);
  const setTableView = useData((s) => s.setTableView);

  // A linked embed reads its own config from the node attrs; a plain embed reads
  // the table's shared `views` (synced) and falls back to the localStorage copy
  // when that field is absent. The instance config, when present, always wins.
  const serverView = table?.views as ViewConfig | undefined;
  const embedView = embed?.viewConfig ?? null;
  const linked = embedView != null;
  const view = useMemo<ViewConfig>(() => {
    if (embedView && embedView.type) return { ...defaultViewConfig(), ...embedView };
    if (serverView && serverView.type) return { ...defaultViewConfig(), ...serverView };
    return loadViewConfig(tableId);
  }, [embedView, serverView, tableId]);

  const updateView = (next: ViewConfig) => {
    if (linked && embed) {
      embed.setViewConfig(next); // persists in the page-content node attrs (already synced)
      return;
    }
    setTableView(tableId, next); // optimistic + server (synced)
    saveViewConfig(tableId, next); // localStorage cache / fallback
  };

  const allRows = useMemo(() => selectRowsForTable(rowsMap, tableId), [rowsMap, tableId]);
  const columns = table?.columns ?? [];
  const myId = useAuth((s) => s.user?.id ?? '');

  // Publish this table's row count and per-column totals so a formula anywhere can
  // read them with tablecount("Table") and tablesum("Table", "Column"), the same
  // way a countdown or budget is referenced. Memoised, so it only recomputes when
  // the rows or columns change.
  const tableName = table?.name ?? '';
  const aggregates = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const col of columns) {
      if (col.type !== 'number' && col.type !== 'formula') continue;
      let s = 0;
      for (const r of allRows) {
        const v = col.type === 'number' ? coerceNumber(r.cells[col.id]) : coerceNumber(evaluateFormula(col.formula ?? '', scopeFor(columns, r.cells)).value);
        if (Number.isFinite(v)) s += v;
      }
      sums[col.name] = s;
    }
    return { count: allRows.length, sums };
  }, [allRows, columns]);
  useEffect(() => {
    if (!tableName) return;
    publishRef('tablecount:', tableName, aggregates.count);
    for (const [col, s] of Object.entries(aggregates.sums)) publishRef('tablesum:', `${tableName}|${col}`, s);
    return () => {
      clearRef('tablecount:', tableName);
      for (const col of Object.keys(aggregates.sums)) clearRef('tablesum:', `${tableName}|${col}`);
    };
  }, [tableName, aggregates]);
  // Re-render when live FX rates arrive so fx() formula cells recompute.
  useSyncExternalStore(subscribeFx, fxVersion, fxVersion);
  // Re-render when a widget value changes so countdown()/budget()/owed() cells recompute.
  useSyncExternalStore(subscribeRefs, refsVersion, refsVersion);
  const rows = useMemo(() => {
    // Resolve the `@me` person-filter sentinel to the current user id here, where
    // auth lives, filterRows stays pure and user-agnostic (never imports auth).
    const resolved = view.filters.some((f) => f.value === '@me')
      ? { ...view, filters: view.filters.map((f) => (f.value === '@me' ? { ...f, value: myId } : f)) }
      : view;
    return applyQuery(allRows, columns, resolved);
  }, [allRows, columns, view, myId]);

  // Conditional-format rules with the `@me` person sentinel resolved, same as
  // filters above, so rowColor can stay pure and auth-free.
  const colorRules = useMemo(() => {
    const rules = view.colorRules;
    if (!rules?.length) return rules;
    return rules.some((r) => r.value === '@me')
      ? rules.map((r) => (r.value === '@me' ? { ...r, value: myId } : r))
      : rules;
  }, [view.colorRules, myId]);

  const [addColOpen, setAddColOpen] = useState(false);
  // Right-click anywhere on the table (except editable fields) → CSV import/export.
  const csvMembers = useMembers();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [csvImport, setCsvImport] = useState(false);
  const onTableContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], select')) return; // keep native paste menu in cells
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };
  const exportCsv = () => {
    const safe = (table?.name || 'table').replace(/[^\w-]+/g, '_');
    download(`${safe}.csv`, tableToCSV(columns, rows, csvMembers), 'text/csv');
    setCtxMenu(null);
  };

  if (!table) {
    return (
      <div className="rounded-lg border border-dashed border-paper-line p-4 text-sm text-ink-faint dark:border-coal-line dark:text-coal-soft">
        This table was deleted or is still loading.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-paper-line bg-paper dark:border-coal-line dark:bg-coal-panel" onContextMenu={onTableContextMenu}>
      {/* Table header / name */}
      <div className="flex items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
        <Tag className="h-4 w-4 text-clay" />
        <input
          value={table.name}
          onChange={(e) => renameTable(tableId, e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-coal-text"
          placeholder="Table name"
        />
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint dark:text-coal-soft">
          {shortId(tableId)}
        </span>
        {embed && embed.editable && (
          <LinkedViewControls embed={embed} linked={linked} view={view} />
        )}
        <TableShareButton tableId={tableId} table={table} rows={rows} view={view} />
        <TableDataMenu tableId={tableId} table={table} rows={rows} view={view} />
        <AutomationsButton tableId={tableId} columns={table.columns} />
      </div>

      {/* View tabs + query controls */}
      <TableToolbar
        tableId={tableId}
        columns={table.columns}
        view={view}
        onChange={updateView}
        total={allRows.length}
        shown={rows.length}
      />

      {/* Active view */}
      {view.type === 'grid' && (
        <GridView tableId={tableId} table={table} rows={rows} view={view} colorRules={colorRules} addColOpen={addColOpen} setAddColOpen={setAddColOpen} />
      )}
      {view.type === 'board' && <BoardView tableId={tableId} table={table} rows={rows} view={view} onChange={updateView} />}
      {view.type === 'gallery' && <GalleryView tableId={tableId} table={table} rows={rows} />}
      {view.type === 'calendar' && <CalendarView tableId={tableId} table={table} rows={rows} view={view} />}
      {view.type === 'schedule' && <ScheduleView tableId={tableId} table={table} rows={rows} view={view} />}
      {view.type === 'timeline' && <TimelineView tableId={tableId} table={table} rows={rows} view={view} />}
      {view.type === 'map' && <MapView tableId={tableId} table={table} rows={rows} view={view} />}
      {view.type === 'route' && <RouteView tableId={tableId} table={table} rows={rows} view={view} />}

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
          <div
            className="fixed z-[61] w-44 overflow-hidden rounded-lg border border-paper-line bg-paper py-1 shadow-2xl dark:border-coal-line dark:bg-coal-panel"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button type="button" onClick={() => { setCsvImport(true); setCtxMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
              <Upload className="h-4 w-4 text-ink-faint" /> Import CSV
            </button>
            <button type="button" onClick={exportCsv} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
              <Download className="h-4 w-4 text-ink-faint" /> Export CSV
            </button>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(tableToCSV(columns, rows, csvMembers)); setCtxMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
              <Copy className="h-4 w-4 text-ink-faint" /> Copy as CSV
            </button>
            {embed?.editable && embed.deleteEmbed && (
              <>
                <div className="my-1 border-t border-paper-line dark:border-coal-line" />
                <button type="button" onClick={() => { embed.deleteEmbed!(); setCtxMenu(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                  <Trash2 className="h-4 w-4" /> Delete table
                </button>
              </>
            )}
          </div>
        </>
      )}
      {csvImport && <CsvImportModal tableId={tableId} onClose={() => setCsvImport(false)} />}
    </div>
  );
}

// --- Linked-view controls ---------------------------------------------------

// Header chrome for embeds: turn a shared embed into an independent "linked
// view", spawn a linked copy beside it, or drop an instance's config back to the
// shared one. Rows never move, only this embed's view differs.
function LinkedViewControls({ embed, linked, view }: { embed: EmbedViewControls; linked: boolean; view: ViewConfig }) {
  if (linked) {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-clay-wash px-1.5 py-0.5 text-[10px] font-medium text-clay dark:bg-clay/20 dark:text-clay-soft">
          <Link2 className="h-3 w-3" /> Linked view
        </span>
        <button
          type="button"
          onClick={() => embed.setViewConfig(null)}
          title="Use the table's shared view instead"
          className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
        >
          <Unlink className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => embed.duplicateLinked(cloneView(view))}
        title="Duplicate as a linked view, same rows, its own filters & view"
        className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => embed.setViewConfig(cloneView(view))}
        title="Make this view independent of the shared table"
        className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// --- Grid view --------------------------------------------------------------

function GridView({
  tableId,
  table,
  rows,
  view,
  colorRules,
  addColOpen,
  setAddColOpen,
}: {
  tableId: string;
  table: { columns: Column[] };
  rows: TableRow[];
  view: ViewConfig;
  colorRules?: ColorRule[];
  addColOpen: boolean;
  setAddColOpen: (v: boolean) => void;
}) {
  const addColumn = useData((s) => s.addColumn);
  const addColBtnRef = useRef<HTMLButtonElement>(null);
  const addRow = useData((s) => s.addRow);
  const addSubRow = useData((s) => s.addSubRow);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildRowTree(rows, collapsed), [rows, collapsed]);
  // Rows whose date span overlaps another's, when "no clashing dates" is set.
  const clashes = useMemo(
    () => (view.clashStartId ? findClashes(rows, view.clashStartId, view.clashEndId) : new Set<string>()),
    [rows, view.clashStartId, view.clashEndId],
  );
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Per-view column hide: the grid renders only these. The data and the formula
  // scope keep every column, so a hidden column still computes, it just does not show.
  const cols = useMemo(
    () => table.columns.filter((c) => !(view.hiddenColumns ?? []).includes(c.id)),
    [table.columns, view.hiddenColumns],
  );

  return (
    <>
      <div className="overflow-x-auto">
        {/* Fixed layout so an explicit column width is honoured (auto layout
            treats it as a hint and redistributes, making the resize look dead).
            The trailing add-column header has no width, so it soaks up the slack
            instead of the browser scaling the real columns. */}
        <table className="w-full border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="border-b border-paper-line dark:border-coal-line">
              {cols.map((col) => (
                <ColumnHeader key={col.id} tableId={tableId} column={col} />
              ))}
              <th className="border-l border-paper-line p-0 dark:border-coal-line" style={{ width: 92 }}>
                <div className="relative">
                  <button
                    ref={addColBtnRef}
                    type="button"
                    onClick={() => setAddColOpen(!addColOpen)}
                    className="flex h-9 w-full items-center justify-center text-ink-faint hover:bg-paper-panel hover:text-ink dark:text-coal-soft dark:hover:bg-coal-line dark:hover:text-coal-text"
                    title="Add column"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <Popover open={addColOpen} onClose={() => setAddColOpen(false)} anchorRef={addColBtnRef} width={180} align="right">
                    {(Object.keys(TYPE_META) as ColumnType[]).map((t) => {
                      const Icon = TYPE_META[t].icon;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            addColumn(tableId, t);
                            setAddColOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
                        >
                          <Icon className="h-4 w-4 text-ink-faint dark:text-coal-soft" />
                          {TYPE_META[t].label}
                        </button>
                      );
                    })}
                  </Popover>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {tree.map(({ row, depth, hasChildren }) => {
              const scope = scopeFor(table.columns, row.cells);
              const clashing = clashes.has(row.id);
              const tint = rowColor(row.cells, colorRules);
              return (
                <tr
                  key={row.id}
                  className={[
                    'group border-b border-paper-line last:border-0 dark:border-coal-line',
                    clashing && !tint ? 'bg-rose-500/[0.06]' : '',
                  ].join(' ')}
                  style={tint ? { backgroundColor: `${tint}14`, boxShadow: `inset 4px 0 0 ${tint}` } : undefined}
                >
                  {cols.map((col, ci) => (
                    <td
                      key={col.id}
                      className="overflow-hidden border-r border-paper-line/60 p-0 align-top last:border-r-0 dark:border-coal-line/60"
                      style={{ width: col.width ?? 180 }}
                    >
                      {ci === 0 ? (
                        <div className="flex items-stretch" style={{ paddingLeft: depth * 16 }}>
                          <span className="flex w-4 shrink-0 items-center justify-center pt-2">
                            {clashing ? (
                              <AlertTriangle className="h-3 w-3 text-rose-500" />
                            ) : hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggle(row.id)}
                                className="text-ink-faint hover:text-clay"
                                title={collapsed.has(row.id) ? 'Expand' : 'Collapse'}
                              >
                                {collapsed.has(row.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            ) : depth > 0 ? (
                              <span className="h-1 w-1 rounded-full bg-paper-line dark:bg-coal-line" />
                            ) : null}
                          </span>
                          {rowIcon(row) &&
                            (isImageIcon(rowIcon(row)) ? (
                              <img src={rowIcon(row)} alt="" className="mt-1.5 ml-0.5 h-4 w-4 shrink-0 rounded object-contain" />
                            ) : (
                              <span className="mt-1.5 ml-0.5 shrink-0 text-sm leading-none">{rowIcon(row)}</span>
                            ))}
                          <div className="min-w-0 flex-1">
                            <Cell tableId={tableId} rowId={row.id} column={col} value={row.cells[col.id] ?? null} scope={scope} />
                          </div>
                        </div>
                      ) : (
                        <Cell tableId={tableId} rowId={row.id} column={col} value={row.cells[col.id] ?? null} scope={scope} />
                      )}
                    </td>
                  ))}
                  <td className="border-l border-paper-line p-0 align-middle dark:border-coal-line" style={{ width: 92 }}>
                    <div className="flex items-center justify-center gap-0.5 px-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            next.delete(row.id);
                            return next;
                          });
                          void addSubRow(row.id);
                        }}
                        className="sm:invisible flex items-center justify-center py-2 text-ink-faint hover:text-clay sm:group-hover:visible"
                        title="Add sub-item"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => useData.getState().openRow(row.id)}
                        className="sm:invisible flex items-center justify-center py-2 text-ink-faint hover:text-clay sm:group-hover:visible"
                        title="Open as page"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => useData.getState().deleteRow(row.id)}
                        className="sm:invisible flex items-center justify-center py-2 text-ink-faint hover:text-red-500 sm:group-hover:visible"
                        title="Delete row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <SummaryRow columns={cols} rows={rows} />
          </tfoot>
        </table>
      </div>

      <button
        type="button"
        onClick={() => addRow(tableId)}
        className="flex w-full items-center gap-2 border-t border-paper-line px-3 py-2 text-sm text-ink-faint hover:bg-paper-panel hover:text-ink dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line dark:hover:text-coal-text"
      >
        <Plus className="h-4 w-4" /> New row
      </button>
    </>
  );
}

// --- Column header (name + type + aggregation + delete) ---------------------

function ColumnHeader({ tableId, column }: { tableId: string; column: Column }) {
  const updateColumn = useData((s) => s.updateColumn);
  const deleteColumn = useData((s) => s.deleteColumn);
  const moveColumn = useData((s) => s.moveColumn);
  const tables = useData((s) => s.tables);
  const [open, setOpen] = useState(false);
  const Icon = TYPE_META[column.type].icon;
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  // Edit the formula in a local draft and commit on blur/Enter. Writing it on every
  // keystroke recomputed every formula cell in the table mid-expression, which both
  // lagged and dropped focus (the "formula is broken" report).
  const [formulaDraft, setFormulaDraft] = useState(column.formula ?? '');
  useEffect(() => {
    setFormulaDraft(column.formula ?? '');
  }, [column.formula]);
  // Form-backed tables are invisible plumbing for /form blocks, don't offer
  // them as relation targets. Scope to the active workspace so relations never
  // point across workspaces.
  const otherTables = useWorkspaceTables().filter((t) => t.id !== tableId && !t.formKey);
  const thisTable = tables[tableId];
  const relationCols = thisTable?.columns.filter((c) => c.type === 'relation' && c.relationTableId) ?? [];
  const rollupTarget = column.rollupRelationColumnId
    ? relationCols.find((c) => c.id === column.rollupRelationColumnId)
    : undefined;
  const targetNumberCols = rollupTarget?.relationTableId
    ? (tables[rollupTarget.relationTableId]?.columns.filter((c) => c.type === 'number' || c.type === 'formula') ?? [])
    : [];
  const targetCheckboxCols = rollupTarget?.relationTableId
    ? (tables[rollupTarget.relationTableId]?.columns.filter((c) => c.type === 'checkbox') ?? [])
    : [];
  // Lookup reuses the same relation list but reads any column on the target.
  const lookupTarget = column.lookupRelationColumnId
    ? relationCols.find((c) => c.id === column.lookupRelationColumnId)
    : undefined;
  const lookupTargetCols = lookupTarget?.relationTableId
    ? (tables[lookupTarget.relationTableId]?.columns ?? [])
    : [];

  // Drag the right edge to resize. updateColumn already debounces the server
  // write, so updating on every move is live for header + body and persists once.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = column.width ?? 180;
    const onMove = (ev: PointerEvent) =>
      updateColumn(tableId, column.id, { width: Math.max(72, Math.round(startW + (ev.clientX - startX))) });
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <th
      className="relative border-r border-paper-line bg-paper-panel/60 p-0 text-left font-medium last:border-r-0 dark:border-coal-line dark:bg-coal/40"
      style={{ width: column.width ?? 180 }}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint dark:text-coal-soft" />
        <input
          value={column.name}
          onChange={(e) => updateColumn(tableId, column.id, { name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-ink-soft outline-none dark:text-coal-soft"
        />
        <button
          ref={menuBtnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded p-0.5 text-ink-faint hover:bg-paper-line dark:hover:bg-coal-line"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Resize handle, sits on the right edge, above the cell content. */}
      <div
        onPointerDown={startResize}
        onClick={(e) => e.stopPropagation()}
        className="absolute -right-1.5 top-0 z-20 h-full w-3 cursor-col-resize touch-none hover:bg-clay/40"
        title="Drag to resize"
      />

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={menuBtnRef} width={252}>
        <div className="p-1.5">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
            Type
          </label>
          <select
            value={column.type}
            onChange={(e) => updateColumn(tableId, column.id, { type: e.target.value as ColumnType })}
            className="mb-2 w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
          >
            {(Object.keys(TYPE_META) as ColumnType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_META[t].label}
              </option>
            ))}
          </select>

          {column.type === 'formula' && (
            <div className="mb-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                Expression
              </label>
              <input
                value={formulaDraft}
                onChange={(e) => setFormulaDraft(e.target.value)}
                onBlur={() => updateColumn(tableId, column.id, { formula: formulaDraft })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateColumn(tableId, column.id, { formula: formulaDraft });
                    e.currentTarget.blur();
                  }
                }}
                placeholder="[Nights] * [Rate]"
                className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 font-mono text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
              />
              <p className="mt-1 text-[10px] leading-tight text-ink-faint dark:text-coal-soft">
                Reference columns in [brackets], or a single-word name bare. Functions: sum, avg, min, max,
                round, if, days, today, workdays, daysoff, holiday (Swedish red days), countdown("label"),
                budget("name"), owed("name", "who"), tablesum("Table", "Col"), tablecount("Table"),
                concat, format, fx.
              </p>
            </div>
          )}

          {column.type === 'relation' && (
            <div className="mb-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                Links to
              </label>
              <select
                value={column.relationTableId ?? ''}
                onChange={(e) => updateColumn(tableId, column.id, { relationTableId: e.target.value || undefined })}
                className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                <option value="">Pick a table…</option>
                {thisTable && (
                  <option value={thisTable.id}>{thisTable.name} (this table, for dependencies)</option>
                )}
                {otherTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {otherTables.length === 0 && (
                <p className="mt-1 text-[10px] text-ink-faint dark:text-coal-soft">No other tables yet, create another table to link to.</p>
              )}
            </div>
          )}

          {column.type === 'person' && (
            <label className="mb-2 flex items-center gap-2 text-xs text-ink dark:text-coal-text">
              <input
                type="checkbox"
                checked={column.peopleMulti ?? false}
                onChange={(e) => updateColumn(tableId, column.id, { peopleMulti: e.target.checked })}
                className="accent-clay"
              />
              Allow multiple people
            </label>
          )}

          {column.type === 'rollup' && (
            <div className="mb-2 space-y-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Through relation
                </label>
                <select
                  value={column.rollupRelationColumnId ?? ''}
                  onChange={(e) =>
                    updateColumn(tableId, column.id, { rollupRelationColumnId: e.target.value || undefined, rollupTargetColumnId: undefined })
                  }
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  <option value="">Pick a relation…</option>
                  {relationCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {relationCols.length === 0 && (
                  <p className="mt-1 text-[10px] text-ink-faint dark:text-coal-soft">Add a Relation column first.</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Aggregate column
                </label>
                <select
                  value={column.rollupTargetColumnId ?? ''}
                  onChange={(e) => updateColumn(tableId, column.id, { rollupTargetColumnId: e.target.value || undefined })}
                  disabled={!rollupTarget}
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink disabled:opacity-50 dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  <option value="">Pick a number column…</option>
                  {targetNumberCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Function
                </label>
                <select
                  value={column.rollupFn ?? 'sum'}
                  onChange={(e) => updateColumn(tableId, column.id, { rollupFn: e.target.value as Column['rollupFn'] })}
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  <option value="sum">Sum</option>
                  <option value="avg">Average</option>
                  <option value="min">Min</option>
                  <option value="max">Max</option>
                  <option value="count">Count linked</option>
                </select>
              </div>
            </div>
          )}

          {column.type === 'lookup' && (
            <div className="mb-2 space-y-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Through relation
                </label>
                <select
                  value={column.lookupRelationColumnId ?? ''}
                  onChange={(e) =>
                    updateColumn(tableId, column.id, { lookupRelationColumnId: e.target.value || undefined, lookupTargetColumnId: undefined })
                  }
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  <option value="">Pick a relation…</option>
                  {relationCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {relationCols.length === 0 && (
                  <p className="mt-1 text-[10px] text-ink-faint dark:text-coal-soft">Add a Relation column first.</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Show column
                </label>
                <select
                  value={column.lookupTargetColumnId ?? ''}
                  onChange={(e) => updateColumn(tableId, column.id, { lookupTargetColumnId: e.target.value || undefined })}
                  disabled={!lookupTarget}
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink disabled:opacity-50 dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  <option value="">Pick a column…</option>
                  {lookupTargetCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {column.type === 'progress' && (
            <div className="mb-2 space-y-2">
              <p className="text-[10px] leading-tight text-ink-faint dark:text-coal-soft">
                Type 0–100 in cells, or auto-fill from linked sub-tasks below.
              </p>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Sub-tasks relation (optional)
                </label>
                <select
                  value={column.rollupRelationColumnId ?? ''}
                  onChange={(e) => updateColumn(tableId, column.id, { rollupRelationColumnId: e.target.value || undefined, rollupTargetColumnId: undefined })}
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  <option value="">Manual (enter %)</option>
                  {relationCols.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {column.rollupRelationColumnId && (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                    Done = checkbox column
                  </label>
                  <select
                    value={column.rollupTargetColumnId ?? ''}
                    onChange={(e) => updateColumn(tableId, column.id, { rollupTargetColumnId: e.target.value || undefined })}
                    className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    <option value="">Pick a checkbox…</option>
                    {targetCheckboxCols.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {column.type === 'button' && (
            <div className="mb-2 space-y-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  Button label
                </label>
                <input
                  value={column.buttonLabel ?? ''}
                  onChange={(e) => updateColumn(tableId, column.id, { buttonLabel: e.target.value })}
                  placeholder="Mark done"
                  className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                  When clicked
                </label>
                <ActionEditor
                  columns={thisTable?.columns ?? []}
                  actions={column.buttonActions ?? []}
                  onChange={(a) => updateColumn(tableId, column.id, { buttonActions: a })}
                />
              </div>
            </div>
          )}

          {column.type === 'reminder' && (
            <div className="mb-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                Remind me
              </label>
              <select
                value={column.reminderLead ?? 'at'}
                onChange={(e) => updateColumn(tableId, column.id, { reminderLead: e.target.value as Column['reminderLead'] })}
                className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                <option value="at">At the time</option>
                <option value="1h">1 hour before</option>
                <option value="1d">1 day before</option>
              </select>
              <p className="mt-1 text-[10px] text-ink-faint dark:text-coal-soft">
                Surfaces in the bell while the app is open.
              </p>
            </div>
          )}

          {(column.type === 'number' || column.type === 'formula' || column.type === 'rollup') && (
            <div className="mb-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                Format
              </label>
              <select
                value={column.numberFormat ?? 'plain'}
                onChange={(e) => updateColumn(tableId, column.id, { numberFormat: e.target.value as Column['numberFormat'] })}
                className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                <option value="plain">Plain (1234.5)</option>
                <option value="comma">Thousands (1,234.5)</option>
                <option value="yen">Yen (¥1,234)</option>
                <option value="sek">Krona (1 234 kr)</option>
                <option value="eur">Euro (€1,234)</option>
                <option value="usd">Dollar ($1,234)</option>
                <option value="percent">Percent (12.3%)</option>
              </select>
            </div>
          )}

          {(column.type === 'number' || column.type === 'formula') && (
            <div className="mb-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft">
                Summary
              </label>
              <select
                value={aggOf(column)}
                onChange={(e) => updateColumn(tableId, column.id, { ...asAgg(e.target.value) } as Partial<Column>)}
                className="w-full rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                <option value="none">None</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
                <option value="count">Count</option>
              </select>
            </div>
          )}

          {(column.type === 'date' || column.type === 'datetime') && (
            <label className="mb-1 flex items-start gap-2 border-t border-paper-line px-1 pt-2 text-xs text-ink dark:border-coal-line dark:text-coal-text">
              <input
                type="checkbox"
                checked={column.agendaDue ?? false}
                onChange={(e) => updateColumn(tableId, column.id, { agendaDue: e.target.checked })}
                className="mt-0.5 accent-clay"
              />
              <span>
                Treat as a deadline
                <span className="block text-[10px] text-ink-faint dark:text-coal-soft">show overdue / today on Home; off for plain calendar dates</span>
              </span>
            </label>
          )}

          <label className="mb-1 flex items-center gap-2 border-t border-paper-line px-1 pt-2 text-xs text-ink dark:border-coal-line dark:text-coal-text">
            <input
              type="checkbox"
              checked={column.dmOnly ?? false}
              onChange={(e) => updateColumn(tableId, column.id, { dmOnly: e.target.checked })}
              className="accent-clay"
            />
            DM-only, hide from share viewers
          </label>

          {/* Reorder this column left or right. */}
          {(() => {
            const cols = thisTable?.columns ?? [];
            const idx = cols.findIndex((c) => c.id === column.id);
            return (
              <div className="mb-1 flex items-center gap-1 border-t border-paper-line pt-1.5 dark:border-coal-line">
                <button
                  type="button"
                  disabled={idx <= 0}
                  onClick={() => moveColumn(tableId, column.id, 'left')}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-soft hover:bg-paper-panel disabled:opacity-40 disabled:hover:bg-transparent dark:text-coal-soft dark:hover:bg-coal-line"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Move left
                </button>
                <button
                  type="button"
                  disabled={idx < 0 || idx >= cols.length - 1}
                  onClick={() => moveColumn(tableId, column.id, 'right')}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-soft hover:bg-paper-panel disabled:opacity-40 disabled:hover:bg-transparent dark:text-coal-soft dark:hover:bg-coal-line"
                >
                  Move right <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })()}

          <button
            type="button"
            onClick={() => {
              deleteColumn(tableId, column.id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            <Trash2 className="h-4 w-4" /> Delete column
          </button>
        </div>
      </Popover>
    </th>
  );
}

function aggOf(column: Column): AggregationKind {
  return column.agg ?? 'none';
}
function asAgg(value: string): { agg: AggregationKind } {
  return { agg: value as AggregationKind };
}

// --- Summary / aggregation footer (respects the active filter) --------------

function SummaryRow({ columns, rows }: { columns: Column[]; rows: TableRow[] }) {
  return (
    <tr className="border-t-2 border-paper-line bg-paper-panel/40 dark:border-coal-line dark:bg-coal/40">
      {columns.map((col) => {
        const kind = aggOf(col);
        let display = '';

        if (kind === 'count') {
          // A checkbox column counts as "ticked / total (pct%)", the live
          // "% packed" for a packing list; any other column just counts rows.
          display = col.type === 'checkbox'
            ? (() => {
                const s = packedStat(rows, col.id);
                return `${s.done}/${s.total} (${s.pct}%)`;
              })()
            : `${rows.length}`;
        } else if (kind !== 'none' && (col.type === 'number' || col.type === 'formula')) {
          const values = rows.map((r) => {
            if (col.type === 'number') return coerceNumber(r.cells[col.id]);
            const scope = scopeFor(columns, r.cells);
            return coerceNumber(evaluateFormula(col.formula ?? '', scope).value);
          });
          const sum = values.reduce((a, b) => a + b, 0);
          if (kind === 'sum') display = formatValue(sum, col.numberFormat);
          else if (kind === 'avg') display = formatValue(values.length ? sum / values.length : 0, col.numberFormat);
          else if (kind === 'min') display = formatValue(values.length ? Math.min(...values) : 0, col.numberFormat);
          else if (kind === 'max') display = formatValue(values.length ? Math.max(...values) : 0, col.numberFormat);
        }

        return (
          <td
            key={col.id}
            className="border-r border-paper-line/60 px-2 py-1.5 text-right font-mono text-[11px] text-ink-soft last:border-r-0 dark:border-coal-line/60 dark:text-coal-soft"
          >
            {display && (
              <span>
                <span className="mr-1 uppercase tracking-wide text-ink-faint dark:text-coal-soft/70">{kind}</span>
                {display}
              </span>
            )}
          </td>
        );
      })}
      <td className="border-l border-paper-line dark:border-coal-line" />
    </tr>
  );
}


// --- Export / Import menu ---------------------------------------------------

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Paste-a-CSV/TSV import dialog. Shared by the toolbar menu and the table's
// right-click menu so the Coda import flow lives in exactly one place.
function CsvImportModal({ tableId, onClose }: { tableId: string; onClose: () => void }) {
  const importRows = useData((s) => s.importRows);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [replace, setReplace] = useState(false);

  const runImport = async (parsed: ReturnType<typeof parseDelimited>) => {
    // For a replace, snapshot the table first so the Undo toast can put it back.
    const snapshot = replace ? useData.getState().captureTableSnapshot(tableId) : null;
    const n = await importRows(tableId, parsed, replace);
    setMsg(`Imported ${n} row${n === 1 ? '' : 's'}${replace ? ' (replaced the table to match the file)' : ''}.`);
    setText('');
    if (replace && snapshot) {
      // Button-only undo (a store op, not an editor edit), so no ctrl+z hint.
      toastWithAction('Replaced the table to match the file.', {
        label: 'Undo',
        run: () => void useData.getState().restoreTableSnapshot(tableId, snapshot),
      });
    }
    setTimeout(onClose, 900);
  };

  const doImport = () => {
    const parsed = parseDelimited(text);
    if (!parsed.headers.length) {
      setMsg('Nothing to import, paste CSV or TSV with a header row.');
      return;
    }
    if (replace) {
      // Destructive: ask in the app's own confirm (same as the widget delete),
      // and the Undo below can still put it back.
      confirmAsk({
        title: 'Replace the table?',
        message: `This wipes the current rows and drops any column not in the file, then imports ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}. You can undo right after.`,
        confirmLabel: 'Replace & import',
        destructive: true,
        onConfirm: () => void runImport(parsed),
      });
    } else {
      void runImport(parsed);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-ink dark:text-coal-text">Import CSV</h3>
        <p className="mb-2 text-xs text-ink-faint dark:text-coal-soft">
          Choose a .csv/.tsv file or paste below (e.g. exported from Coda or a spreadsheet). The first row is treated as
          headers; columns are matched by name, new ones are created, and true/false columns import as checkboxes.
        </p>
        <label className="mb-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-paper-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft">
          <Upload className="h-3.5 w-3.5" />
          Choose a file
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // let the same file be re-picked later
              if (!file) return;
              try {
                setText(await file.text()); // file.text() reads UTF-8, so emoji/kanji survive
                setMsg(`Loaded ${file.name}. Review, then Import.`);
              } catch {
                setMsg('Could not read that file.');
              }
            }}
          />
        </label>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'Name,Visited\nFukuoka Tower,false\nOhori Park,true'}
          className="w-full rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-ink-soft dark:text-coal-soft">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 accent-clay" />
          <span>Make the table match this file: wipe all current rows AND drop any column the file does not have. Off = just add these rows, keeping the current rows and columns.</span>
        </label>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-clay">{msg}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft dark:border-coal-line dark:text-coal-soft">Cancel</button>
            <button type="button" onClick={doImport} className={['rounded-lg px-3 py-1.5 text-sm font-medium text-white', replace ? 'bg-red-500 hover:bg-red-600' : 'bg-clay hover:bg-clay/90'].join(' ')}>{replace ? 'Replace & import' : 'Import'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Its own header button (not tucked inside the export menu): a read-only public
// share of the table, recipe-style. Publishes a PLAINTEXT snapshot as a
// self-contained sharedTableBlock (header + baked cell display strings, formulas
// evaluated; the open view type is recorded so the shared copy can present it).
// Token stored per table in localStorage. Create / update / stop.
function TableShareButton({ tableId, table, rows, view }: { tableId: string; table: TableData; rows: TableRow[]; view: ViewConfig }) {
  const tables = useData((s) => s.tables);
  const rowsMap = useData((s) => s.rows);
  const publishShared = useData((s) => s.publishShared);
  const updateShared = useData((s) => s.updateShared);
  const unpublishShared = useData((s) => s.unpublishShared);
  const wsId = useWorkspace((s) => s.activeWorkspaceId ?? '');
  const members = useMembers();

  const SHARE_KEY = `waypoint:tableshare:${tableId}`;
  const [share, setShare] = useState<{ shareId: string; token: string } | null>(() => {
    try {
      const raw = localStorage.getItem(SHARE_KEY);
      return raw ? (JSON.parse(raw) as { shareId: string; token: string }) : null;
    } catch {
      return null;
    }
  });
  const setShareRec = (rec: { shareId: string; token: string } | null) => {
    try {
      if (rec) localStorage.setItem(SHARE_KEY, JSON.stringify(rec));
      else localStorage.removeItem(SHARE_KEY);
    } catch {
      /* ignore */
    }
    setShare(rec);
  };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = share ? `${window.location.origin}${window.location.pathname}?share=${share.token}` : '';
  const bakeDoc = () => {
    const model = bakeSharedTable(
      table.columns,
      rows,
      view,
      table.name || 'Table',
      (r, c) => cellDisplay(table, r, c, tables, rowsMap, members),
      (id) => members.find((m) => m.id === id)?.name ?? id,
    );
    return { type: 'doc', content: [{ type: 'sharedTableBlock', attrs: { model } }] };
  };
  const createShare = async () => {
    setBusy(true);
    const res = await publishShared(wsId, table.name || 'Table', bakeDoc());
    setBusy(false);
    if (res) setShareRec({ shareId: res.pageId, token: res.token });
  };
  const refreshShare = async () => {
    if (share) await updateShared(share.shareId, table.name || 'Table', bakeDoc());
  };
  const stopShare = async () => {
    if (share) await unpublishShared(share.shareId);
    setShareRec(null);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share a read-only link"
        className={`rounded p-1 hover:bg-paper-panel dark:hover:bg-coal-line ${share ? 'text-clay' : 'text-ink-faint hover:text-ink dark:hover:text-coal-text'}`}
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink dark:text-coal-text">
              <Globe className="h-4 w-4 text-clay" /> Share &ldquo;{table.name || 'table'}&rdquo;
            </h3>
            {share ? (
              <>
                <p className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
                  Anyone with this link can view a read-only snapshot of this table. No account; nothing else of yours is shown. It doesn&rsquo;t update on its own, use &ldquo;Update&rdquo; after changes.
                </p>
                <div className="flex items-center gap-1.5">
                  <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-paper-line bg-paper-panel px-2 py-1 text-xs text-ink-soft outline-none dark:border-coal-line dark:bg-coal dark:text-coal-soft" />
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className="shrink-0 rounded bg-clay px-2 py-1 text-xs font-medium text-white hover:bg-clay/90" title="Copy link">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <button type="button" onClick={() => void refreshShare()} className="flex items-center gap-1 text-ink-soft hover:text-clay dark:text-coal-soft">
                    <RefreshCw className="h-3 w-3" /> Update snapshot
                  </button>
                  <button type="button" onClick={() => void stopShare()} className="ml-auto flex items-center gap-1 text-ink-faint hover:text-rose-500">
                    <Trash2 className="h-3 w-3" /> Stop sharing
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-xs text-ink-soft dark:text-coal-soft">
                  Create a read-only link to show this table (a plaintext snapshot, formulas included) to anyone. It&rsquo;s a separate public copy; the rest of your workspace stays private.
                </p>
                <button type="button" onClick={() => void createShare()} disabled={busy} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-50">
                  <Share2 className="h-3.5 w-3.5" /> {busy ? 'Creating…' : 'Create a read-only link'}
                </button>
              </>
            )}
            <div className="mt-3 text-right">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft dark:border-coal-line dark:text-coal-soft">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TableDataMenu({ tableId, table, rows, view }: { tableId: string; table: TableData; rows: TableRow[]; view: ViewConfig }) {
  const addRow = useData((s) => s.addRow);
  const setCell = useData((s) => s.setCell);
  const openRow = useData((s) => s.openRow);
  const members = useMembers();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkMsg, setLinkMsg] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const safeName = (table.name || 'table').replace(/[^\w-]+/g, '_');

  // Auto-fill a new row from a pasted hotel / flight / Google-Maps URL. Pure
  // parsing decides the title + any coordinates; Microlink refines the title and
  // a geocode resolves a place when the URL didn't carry coordinates. Every step
  // is best-effort, the row is created first so nothing blocks on the network,
  // and the user lands in the row detail to fill any gaps by hand.
  const doLink = async () => {
    const raw = linkUrl.trim();
    if (!raw) {
      setLinkMsg('Paste a link first.');
      return;
    }
    setLinkBusy(true);
    setLinkMsg('');
    const plan = planUrlImport(raw);
    const titleCol = titleColumn(table.columns);
    const placeCol = firstPlaceColumn(table.columns);
    const urlCol = table.columns.find((c) => c.type === 'url');
    const initial: Record<string, CellValue> = {};
    if (titleCol) initial[titleCol.id] = plan.title;
    if (urlCol) initial[urlCol.id] = plan.url;
    if (placeCol && plan.geo) initial[placeCol.id] = plan.geo;

    const rowId = await addRow(tableId, initial);
    if (!rowId) {
      setLinkBusy(false);
      setLinkMsg('Could not add the row.');
      return;
    }

    void (async () => {
      let bestTitle = plan.title;
      if (!plan.isMaps) {
        const meta = await fetchLinkMeta(plan.url);
        if (meta?.title) {
          bestTitle = meta.title;
          if (titleCol) setCell(rowId, titleCol.id, meta.title);
        }
      }
      if (placeCol && !plan.geo) {
        const q = (plan.placeQuery || bestTitle).trim();
        if (q) {
          const hits = await searchPois(q);
          if (hits[0]) setCell(rowId, placeCol.id, poiToGeo(hits[0]));
        }
      }
    })();

    setLinkBusy(false);
    setLinkUrl('');
    setLinkMsg('Added, opening…');
    setTimeout(() => {
      setLinking(false);
      setLinkMsg('');
      openRow(rowId);
    }, 500);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
        title="Import / export"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} width={208} align="right">
        <button type="button" onClick={() => { download(`${safeName}.csv`, tableToCSV(table.columns, rows, members), 'text/csv'); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <Download className="h-4 w-4 text-ink-faint" /> Download CSV
        </button>
        <button type="button" onClick={() => { download(`${safeName}.md`, tableToMarkdown(table.columns, rows, members), 'text/markdown'); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <FileText className="h-4 w-4 text-ink-faint" /> Download Markdown
        </button>
        <button type="button" onClick={() => { download(`${safeName}.ics`, tableToICS(table, rows, view), 'text/calendar'); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <CalendarPlus className="h-4 w-4 text-ink-faint" /> Download .ics (calendar)
        </button>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(tableToMarkdown(table.columns, rows, members)); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <Copy className="h-4 w-4 text-ink-faint" /> Copy as Markdown
        </button>
        <button type="button" onClick={() => { setImporting(true); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <Upload className="h-4 w-4 text-ink-faint" /> Paste / import CSV
        </button>
        <button type="button" onClick={() => { setLinking(true); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line">
          <Link2 className="h-4 w-4 text-ink-faint" /> Add row from link
        </button>
      </Popover>
      {importing && <CsvImportModal tableId={tableId} onClose={() => setImporting(false)} />}
      {linking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={() => setLinking(false)}>
          <div className="w-full max-w-md rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold text-ink dark:text-coal-text">Add row from link</h3>
            <p className="mb-2 text-xs text-ink-faint dark:text-coal-soft">
              Paste a hotel, flight, or Google Maps link. The title goes in {titleColumn(table.columns)?.name ?? 'the first column'}
              {firstPlaceColumn(table.columns) ? `, and a place into ${firstPlaceColumn(table.columns)!.name}` : ''} where it can be worked out. Anything missing, fill in by hand.
            </p>
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !linkBusy && doLink()}
              placeholder="https://maps.google.com/…"
              className="w-full rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-clay">{linkMsg}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setLinking(false)} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft dark:border-coal-line dark:text-coal-soft">Cancel</button>
                <button type="button" onClick={doLink} disabled={linkBusy} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-60">{linkBusy ? 'Adding…' : 'Add'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
