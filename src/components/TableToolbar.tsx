import { useState } from 'react';
import {
  Table2,
  Columns3,
  LayoutGrid,
  CalendarDays,
  CalendarClock,
  GanttChartSquare,
  Map as MapIcon,
  Route,
  SlidersHorizontal,
  ArrowUpDown,
  Eye,
  Plus,
  X,
  Palette,
} from 'lucide-react';
import type { Column } from '../types';
import {
  OPS_BY_TYPE,
  ROW_COLORS,
  firstSelectColumn,
  firstDateColumn,
  firstDatetimeColumn,
  firstPlaceColumn,
  type ViewConfig,
  type ViewType,
  type Filter,
  type SortRule,
  type FilterOp,
  type ColorRule,
} from '../lib/tableQuery';
import { PROFILE_LABEL, type RouteProfile } from '../lib/routing';
import { useMembers } from '../hooks/useMembers';
import { uid } from '../lib/id';

const VIEW_TABS: { type: ViewType; icon: typeof Table2; label: string }[] = [
  { type: 'grid', icon: Table2, label: 'Grid' },
  { type: 'board', icon: Columns3, label: 'Board' },
  { type: 'gallery', icon: LayoutGrid, label: 'Gallery' },
  { type: 'calendar', icon: CalendarDays, label: 'Calendar' },
  { type: 'schedule', icon: CalendarClock, label: 'Schedule' },
  { type: 'timeline', icon: GanttChartSquare, label: 'Timeline' },
  { type: 'map', icon: MapIcon, label: 'Map' },
  { type: 'route', icon: Route, label: 'Route' },
];

export function TableToolbar({
  tableId,
  columns,
  view,
  onChange,
  total,
  shown,
  hideViewTabs = false,
}: {
  tableId: string;
  columns: Column[];
  view: ViewConfig;
  onChange: (next: ViewConfig) => void;
  total: number;
  shown: number;
  hideViewTabs?: boolean; // the Kanban tab is always a board, so it hides the view-type switcher
}) {
  const [panel, setPanel] = useState<'filter' | 'sort' | 'fields' | 'color' | null>(null);

  const switchType = (type: ViewType) => {
    const next: ViewConfig = { ...view, type };
    if (type === 'board' && !next.groupColumnId)
      next.groupColumnId = (firstSelectColumn(columns) ?? columns.find((c) => c.type === 'person'))?.id;
    if ((type === 'calendar' || type === 'timeline') && !next.dateColumnId) next.dateColumnId = firstDateColumn(columns)?.id;
    if (type === 'schedule' && !next.startTimeColumnId) next.startTimeColumnId = firstDatetimeColumn(columns)?.id;
    if (type === 'map' && !next.placeColumnId) next.placeColumnId = firstPlaceColumn(columns)?.id;
    if (type === 'route') {
      if (!next.placeColumnId) next.placeColumnId = firstPlaceColumn(columns)?.id;
      if (!next.arrivalColumnId) next.arrivalColumnId = firstDateColumn(columns)?.id;
    }
    onChange(next);
  };

  const filtered = view.filters.length > 0;
  const sorted = view.sorts.length > 0;

  // Quick-filter chips: one-tap common filters, toggled by a stable filter id.
  const personCol = columns.find((c) => c.type === 'person');
  const checkboxCol = columns.find((c) => c.type === 'checkbox');
  const dateCol = columns.find((c) => c.type === 'date' || c.type === 'datetime');
  const hasF = (id: string) => view.filters.some((f) => f.id === id);
  const toggleChip = (adds: Filter[]) => {
    const ids = adds.map((f) => f.id);
    const on = ids.every((id) => hasF(id));
    const rest = view.filters.filter((f) => !ids.includes(f.id));
    onChange({ ...view, filters: on ? rest : [...rest, ...adds] });
  };
  const weekRange = () => {
    const d = new Date();
    const start = new Date(d);
    start.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { start: iso(start), end: iso(end) };
  };
  const chipClass = (on: boolean) =>
    [
      'rounded-full px-2.5 py-0.5 text-xs',
      on
        ? 'bg-clay text-white'
        : 'border border-paper-line text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line',
    ].join(' ');

  return (
    <div className="relative flex flex-wrap items-center gap-1 border-b border-paper-line px-2 py-1.5 dark:border-coal-line">
      {/* View type tabs */}
      {!hideViewTabs && (
      <div className="flex items-center gap-0.5">
        {VIEW_TABS.map((t) => {
          const Icon = t.icon;
          const active = view.type === t.type;
          return (
            <button
              key={t.type}
              type="button"
              onClick={() => switchType(t.type)}
              className={[
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
                  : 'text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>
      )}

      {/* Quick-filter chips */}
      {(personCol || checkboxCol || dateCol) && (
        <>
          <div className="mx-1 h-4 w-px bg-paper-line dark:bg-coal-line" />
          {personCol && (
            <button type="button" onClick={() => toggleChip([{ id: 'qf-mine', columnId: personCol.id, op: 'includes', value: '@me' }])} className={chipClass(hasF('qf-mine'))}>
              Mine
            </button>
          )}
          {checkboxCol && (
            <button type="button" onClick={() => toggleChip([{ id: 'qf-undone', columnId: checkboxCol.id, op: 'isUnchecked', value: false }])} className={chipClass(hasF('qf-undone'))}>
              Unfinished
            </button>
          )}
          {dateCol && (
            <button
              type="button"
              onClick={() => {
                const w = weekRange();
                toggleChip([
                  { id: 'qf-week-a', columnId: dateCol.id, op: 'onOrAfter', value: w.start },
                  { id: 'qf-week-b', columnId: dateCol.id, op: 'onOrBefore', value: w.end },
                ]);
              }}
              className={chipClass(hasF('qf-week-a'))}
            >
              This week
            </button>
          )}
        </>
      )}

      <div className="mx-1 h-4 w-px bg-paper-line dark:bg-coal-line" />

      {/* Group by (board) / Date by (calendar) */}
      {view.type === 'board' && (
        <ColumnPicker
          label="Group by"
          columns={columns.filter((c) => c.type === 'select' || c.type === 'person')}
          value={view.groupColumnId}
          onChange={(id) => onChange({ ...view, groupColumnId: id })}
          emptyHint="needs a Select or Person column"
        />
      )}
      {view.type === 'map' && (
        <ColumnPicker
          label="Pin by"
          columns={columns.filter((c) => c.type === 'place')}
          value={view.placeColumnId}
          onChange={(id) => onChange({ ...view, placeColumnId: id })}
          emptyHint="needs a Place column"
        />
      )}
      {view.type === 'map' && (
        <ColumnPicker
          label="Color by"
          columns={columns.filter((c) => c.type === 'select')}
          value={view.categoryColumnId}
          onChange={(id) => onChange({ ...view, categoryColumnId: id })}
          emptyHint=""
        />
      )}
      {view.type === 'route' && (
        <>
          <ColumnPicker
            label="Pin by"
            columns={columns.filter((c) => c.type === 'place')}
            value={view.placeColumnId}
            onChange={(id) => onChange({ ...view, placeColumnId: id })}
            emptyHint="needs a Place column"
          />
          <ColumnPicker
            label="Arrive"
            columns={columns.filter((c) => c.type === 'date' || c.type === 'datetime')}
            value={view.arrivalColumnId}
            onChange={(id) => onChange({ ...view, arrivalColumnId: id })}
            emptyHint="needs a Date column"
          />
          <ColumnPicker
            label="Depart"
            columns={columns.filter((c) => c.type === 'date' || c.type === 'datetime')}
            value={view.departureColumnId}
            onChange={(id) => onChange({ ...view, departureColumnId: id })}
            emptyHint=""
          />
          <label className="flex items-center gap-1 text-[11px] text-ink-faint dark:text-coal-soft">
            Mode
            <select
              value={view.routeProfile ?? 'driving'}
              onChange={(e) => onChange({ ...view, routeProfile: e.target.value as RouteProfile })}
              className="rounded-md border border-paper-line bg-paper px-1.5 py-1 text-[11px] text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
            >
              {(Object.keys(PROFILE_LABEL) as RouteProfile[]).map((p) => (
                <option key={p} value={p}>
                  {PROFILE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {view.type === 'schedule' && (
        <>
          <ColumnPicker
            label="Start"
            columns={columns.filter((c) => c.type === 'datetime')}
            value={view.startTimeColumnId}
            onChange={(id) => onChange({ ...view, startTimeColumnId: id })}
            emptyHint="needs a Date & time column"
          />
          <ColumnPicker
            label="End"
            columns={columns.filter((c) => c.type === 'datetime')}
            value={view.endTimeColumnId}
            onChange={(id) => onChange({ ...view, endTimeColumnId: id })}
            emptyHint=""
          />
        </>
      )}
      {(view.type === 'calendar' || view.type === 'timeline') && (
        <>
          <ColumnPicker
            label="Start"
            columns={columns.filter((c) => c.type === 'date' || c.type === 'datetime')}
            value={view.dateColumnId}
            onChange={(id) => onChange({ ...view, dateColumnId: id })}
            emptyHint="needs a Date column"
          />
          <ColumnPicker
            label="End"
            columns={columns.filter((c) => c.type === 'date' || c.type === 'datetime')}
            value={view.endDateColumnId}
            onChange={(id) => onChange({ ...view, endDateColumnId: id })}
            emptyHint=""
          />
          {view.type === 'calendar' && (
            <MonthYearPicker
              value={view.defaultMonth}
              onChange={(v) => onChange({ ...view, defaultMonth: v })}
            />
          )}
          {view.type === 'timeline' && (
            <>
              <ColumnPicker
                label="Depends on"
                columns={columns.filter((c) => c.type === 'relation' && c.relationTableId === tableId)}
                value={view.dependsOnColumnId}
                onChange={(id) => onChange({ ...view, dependsOnColumnId: id })}
                emptyHint="needs a self-linking Relation column"
              />
              {view.dependsOnColumnId && (
                <label className="flex items-center gap-1 text-[11px] text-ink-faint dark:text-coal-soft">
                  <input
                    type="checkbox"
                    checked={view.enforceDependencies ?? false}
                    onChange={(e) => onChange({ ...view, enforceDependencies: e.target.checked })}
                    className="accent-clay"
                  />
                  Enforce
                </label>
              )}
              <ColumnPicker
                label="Color by"
                columns={columns.filter((c) => c.type === 'person')}
                value={view.colorColumnId}
                onChange={(id) => onChange({ ...view, colorColumnId: id })}
                emptyHint=""
              />
            </>
          )}
        </>
      )}

      {/* Filter */}
      <button
        type="button"
        onClick={() => setPanel(panel === 'filter' ? null : 'filter')}
        className={[
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
          filtered
            ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
            : 'text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line',
        ].join(' ')}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filter{filtered ? ` · ${view.filters.length}` : ''}
      </button>

      {/* Sort */}
      <button
        type="button"
        onClick={() => setPanel(panel === 'sort' ? null : 'sort')}
        className={[
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
          sorted
            ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
            : 'text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line',
        ].join(' ')}
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        Sort{sorted ? ` · ${view.sorts.length}` : ''}
      </button>

      {/* Fields: per-view column show/hide */}
      <button
        type="button"
        onClick={() => setPanel(panel === 'fields' ? null : 'fields')}
        className={[
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
          (view.hiddenColumns?.length ?? 0) > 0
            ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
            : 'text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line',
        ].join(' ')}
      >
        <Eye className="h-3.5 w-3.5" />
        Fields{(view.hiddenColumns?.length ?? 0) > 0 ? ` · ${view.hiddenColumns!.length} hidden` : ''}
      </button>

      {/* Colour: conditional formatting, tint a row whose cells match a rule */}
      <button
        type="button"
        onClick={() => setPanel(panel === 'color' ? null : 'color')}
        className={[
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
          (view.colorRules?.length ?? 0) > 0
            ? 'bg-clay-wash text-clay dark:bg-clay/20 dark:text-clay-soft'
            : 'text-ink-faint hover:bg-paper-panel hover:text-ink-soft dark:text-coal-soft dark:hover:bg-coal-line',
        ].join(' ')}
      >
        <Palette className="h-3.5 w-3.5" />
        Colour{(view.colorRules?.length ?? 0) > 0 ? ` · ${view.colorRules!.length}` : ''}
      </button>

      {/* No clashing dates: flag rows whose date span overlaps another's. */}
      {columns.some((c) => c.type === 'date' || c.type === 'datetime' || c.type === 'reminder') && (
        <>
          <div className="mx-1 h-4 w-px bg-paper-line dark:bg-coal-line" />
          <ColumnPicker
            label="No clashes on"
            columns={columns.filter((c) => c.type === 'date' || c.type === 'datetime' || c.type === 'reminder')}
            value={view.clashStartId}
            onChange={(id) => onChange({ ...view, clashStartId: id })}
            emptyHint="needs a date column"
          />
          {view.clashStartId && (
            <ColumnPicker
              label="to"
              columns={columns.filter((c) => c.type === 'date' || c.type === 'datetime' || c.type === 'reminder')}
              value={view.clashEndId}
              onChange={(id) => onChange({ ...view, clashEndId: id })}
              emptyHint=""
            />
          )}
        </>
      )}

      {filtered && (
        <span className="ml-auto pr-1 text-[11px] text-ink-faint dark:text-coal-soft">
          {shown} of {total}
        </span>
      )}

      {panel === 'filter' && (
        <FilterPanel columns={columns} view={view} onChange={onChange} onClose={() => setPanel(null)} />
      )}
      {panel === 'sort' && (
        <SortPanel columns={columns} view={view} onChange={onChange} onClose={() => setPanel(null)} />
      )}
      {panel === 'fields' && (
        <FieldsPanel columns={columns} view={view} onChange={onChange} onClose={() => setPanel(null)} />
      )}
      {panel === 'color' && (
        <ColorRulePanel columns={columns} view={view} onChange={onChange} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

function FieldsPanel({
  columns,
  view,
  onChange,
  onClose,
}: {
  columns: Column[];
  view: ViewConfig;
  onChange: (next: ViewConfig) => void;
  onClose: () => void;
}) {
  const hidden = new Set(view.hiddenColumns ?? []);
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...view, hiddenColumns: [...next] });
  };
  return (
    <Pop onClose={onClose}>
      <p className="px-1 pb-1.5 text-[11px] text-ink-faint dark:text-coal-soft">show or hide columns in this view. the data and any formulas are untouched.</p>
      <div className="space-y-0.5">
        {columns.map((c) => (
          <label
            key={c.id}
            className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-ink hover:bg-paper-panel dark:text-coal-text dark:hover:bg-coal-line"
          >
            <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggle(c.id)} className="accent-clay" />
            {c.name || 'Untitled'}
          </label>
        ))}
        {columns.length === 0 && <p className="px-1 py-2 text-xs text-ink-faint dark:text-coal-soft">No columns yet.</p>}
      </div>
    </Pop>
  );
}

function ColumnPicker({
  label,
  columns,
  value,
  onChange,
  emptyHint,
}: {
  label: string;
  columns: Column[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  emptyHint: string;
}) {
  if (columns.length === 0) {
    return <span className="px-1 text-[11px] italic text-ink-faint dark:text-coal-soft">{emptyHint}</span>;
  }
  return (
    <label className="flex items-center gap-1 text-[11px] text-ink-faint dark:text-coal-soft">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
      >
        <option value="">-</option>
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Month + Year dropdowns for the calendar's "Opens on" default month.
function MonthYearPicker({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const curY = new Date().getFullYear();
  const valid = value && /^\d{4}-\d{2}$/.test(value);
  const yy = valid ? Number(value!.slice(0, 4)) : undefined;
  const mm = valid ? Number(value!.slice(5, 7)) : undefined;
  const years: number[] = [];
  for (let y = curY - 1; y <= curY + 6; y++) years.push(y);

  const selectCls =
    'rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text';

  const setMonth = (m: number | undefined) => {
    if (!m) return onChange(undefined); // "Auto"
    onChange(`${yy ?? curY}-${String(m).padStart(2, '0')}`);
  };
  const setYear = (y: number) => {
    onChange(`${y}-${String(mm ?? 1).padStart(2, '0')}`);
  };

  return (
    <label className="flex items-center gap-1 text-[11px] text-ink-faint dark:text-coal-soft">
      Opens on
      <select value={mm ?? ''} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : undefined)} className={selectCls}>
        <option value="">Auto</option>
        {MONTH_NAMES.map((n, i) => (
          <option key={i} value={i + 1}>
            {n}
          </option>
        ))}
      </select>
      <select value={yy ?? curY} onChange={(e) => setYear(Number(e.target.value))} className={selectCls} disabled={!mm}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-20" onMouseDown={onClose} />
      <div className="absolute left-2 top-full z-30 mt-1 w-[22rem] rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
        {children}
      </div>
    </>
  );
}

function FilterPanel({
  columns,
  view,
  onChange,
  onClose,
}: {
  columns: Column[];
  view: ViewConfig;
  onChange: (next: ViewConfig) => void;
  onClose: () => void;
}) {
  const setFilters = (filters: Filter[]) => onChange({ ...view, filters });

  const addFilter = () => {
    const col = columns[0];
    if (!col) return;
    const op = (OPS_BY_TYPE[col.type] ?? OPS_BY_TYPE.text)[0].op;
    setFilters([...view.filters, { id: uid(), columnId: col.id, op, value: null }]);
  };

  return (
    <Pop onClose={onClose}>
      {view.filters.length === 0 && (
        <p className="px-1 py-2 text-xs text-ink-faint dark:text-coal-soft">No filters yet.</p>
      )}
      <div className="space-y-1.5">
        {view.filters.map((f) => {
          const col = columns.find((c) => c.id === f.columnId) ?? columns[0];
          const ops = OPS_BY_TYPE[col.type] ?? OPS_BY_TYPE.text;
          const opMeta = ops.find((o) => o.op === f.op) ?? ops[0];
          return (
            <div key={f.id} className="flex items-center gap-1">
              <select
                value={f.columnId}
                onChange={(e) => {
                  const nc = columns.find((c) => c.id === e.target.value)!;
                  const nop = (OPS_BY_TYPE[nc.type] ?? OPS_BY_TYPE.text)[0].op;
                  setFilters(view.filters.map((x) => (x.id === f.id ? { ...x, columnId: nc.id, op: nop, value: null } : x)));
                }}
                className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={f.op}
                onChange={(e) => setFilters(view.filters.map((x) => (x.id === f.id ? { ...x, op: e.target.value as FilterOp } : x)))}
                className="rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
              >
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              {!opMeta.noValue && <FilterValueInput column={col} value={f.value} onChange={(v) => setFilters(view.filters.map((x) => (x.id === f.id ? { ...x, value: v } : x)))} />}
              <button
                type="button"
                onClick={() => setFilters(view.filters.filter((x) => x.id !== f.id))}
                className="shrink-0 rounded p-1 text-ink-faint hover:text-red-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addFilter}
        className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-clay hover:bg-clay-wash dark:hover:bg-clay/15"
      >
        <Plus className="h-3.5 w-3.5" /> Add filter
      </button>
    </Pop>
  );
}

// Conditional formatting: a list of colour rules, each reading like a filter
// (column / op / value) plus a tint. First matching rule colours the row.
function ColorRulePanel({
  columns,
  view,
  onChange,
  onClose,
}: {
  columns: Column[];
  view: ViewConfig;
  onChange: (next: ViewConfig) => void;
  onClose: () => void;
}) {
  const rules = view.colorRules ?? [];
  const setRules = (colorRules: ColorRule[]) => onChange({ ...view, colorRules });
  const addRule = () => {
    const col = columns[0];
    if (!col) return;
    const op = (OPS_BY_TYPE[col.type] ?? OPS_BY_TYPE.text)[0].op;
    setRules([...rules, { id: uid(), columnId: col.id, op, value: null, color: ROW_COLORS[rules.length % ROW_COLORS.length].hex }]);
  };

  return (
    <Pop onClose={onClose}>
      <p className="px-1 pb-1 text-[11px] text-ink-faint dark:text-coal-soft">Tint a row when it matches. First rule that matches wins.</p>
      {rules.length === 0 && <p className="px-1 py-2 text-xs text-ink-faint dark:text-coal-soft">No colour rules yet.</p>}
      <div className="space-y-1.5">
        {rules.map((r) => {
          const col = columns.find((c) => c.id === r.columnId) ?? columns[0];
          const ops = OPS_BY_TYPE[col.type] ?? OPS_BY_TYPE.text;
          const opMeta = ops.find((o) => o.op === r.op) ?? ops[0];
          return (
            <div key={r.id} className="space-y-1 rounded-md border border-paper-line p-1.5 dark:border-coal-line">
              <div className="flex items-center gap-1">
                <select
                  value={r.columnId}
                  onChange={(e) => {
                    const nc = columns.find((c) => c.id === e.target.value)!;
                    const nop = (OPS_BY_TYPE[nc.type] ?? OPS_BY_TYPE.text)[0].op;
                    setRules(rules.map((x) => (x.id === r.id ? { ...x, columnId: nc.id, op: nop, value: null } : x)));
                  }}
                  className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={r.op}
                  onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, op: e.target.value as FilterOp } : x)))}
                  className="rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                >
                  {ops.map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setRules(rules.filter((x) => x.id !== r.id))} className="shrink-0 rounded p-1 text-ink-faint hover:text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {!opMeta.noValue && <FilterValueInput column={col} value={r.value} onChange={(v) => setRules(rules.map((x) => (x.id === r.id ? { ...x, value: v } : x)))} />}
              <div className="flex items-center gap-1 pt-0.5">
                {ROW_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.name}
                    onClick={() => setRules(rules.map((x) => (x.id === r.id ? { ...x, color: c.hex } : x)))}
                    className={`h-4 w-4 rounded-full ring-1 ring-black/10 ${r.color.toLowerCase() === c.hex.toLowerCase() ? 'outline outline-2 outline-offset-1 outline-ink dark:outline-coal-text' : ''}`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addRule}
        className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-clay hover:bg-clay-wash dark:hover:bg-clay/15"
      >
        <Plus className="h-3.5 w-3.5" /> Add colour rule
      </button>
    </Pop>
  );
}

function FilterValueInput({
  column,
  value,
  onChange,
}: {
  column: Column;
  value: import('../types').CellValue;
  onChange: (v: import('../types').CellValue) => void;
}) {
  const members = useMembers();
  if (column.type === 'person') {
    // `@me` is a sentinel resolved to the current user id at query time, so the
    // same saved filter follows whoever's signed in.
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
      >
        <option value="">-</option>
        <option value="@me">Me</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    );
  }
  if (column.type === 'select' || column.type === 'multiselect') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
      >
        <option value="">-</option>
        {(column.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const type = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
  return (
    <input
      type={type}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(type === 'number' ? (raw === '' ? null : Number(raw)) : raw === '' ? null : raw);
      }}
      placeholder="value"
      className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
    />
  );
}

function SortPanel({
  columns,
  view,
  onChange,
  onClose,
}: {
  columns: Column[];
  view: ViewConfig;
  onChange: (next: ViewConfig) => void;
  onClose: () => void;
}) {
  const setSorts = (sorts: SortRule[]) => onChange({ ...view, sorts });
  const addSort = () => {
    const col = columns[0];
    if (!col) return;
    setSorts([...view.sorts, { id: uid(), columnId: col.id, dir: 'asc' }]);
  };
  return (
    <Pop onClose={onClose}>
      {view.sorts.length === 0 && (
        <p className="px-1 py-2 text-xs text-ink-faint dark:text-coal-soft">No sorts yet.</p>
      )}
      <div className="space-y-1.5">
        {view.sorts.map((s) => (
          <div key={s.id} className="flex items-center gap-1">
            <select
              value={s.columnId}
              onChange={(e) => setSorts(view.sorts.map((x) => (x.id === s.id ? { ...x, columnId: e.target.value } : x)))}
              className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={s.dir}
              onChange={(e) => setSorts(view.sorts.map((x) => (x.id === s.id ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x)))}
              className="rounded border border-paper-line bg-paper px-1 py-1 text-xs text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <button
              type="button"
              onClick={() => setSorts(view.sorts.filter((x) => x.id !== s.id))}
              className="shrink-0 rounded p-1 text-ink-faint hover:text-red-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addSort}
        className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-clay hover:bg-clay-wash dark:hover:bg-clay/15"
      >
        <Plus className="h-3.5 w-3.5" /> Add sort
      </button>
    </Pop>
  );
}
