import { useMemo, useState, type ReactNode } from 'react';
import {
  BedDouble, BookMarked, CalendarClock, Check, ChefHat, Dices, ExternalLink, GraduationCap, Home, Luggage, Map as MapIcon,
  NotebookPen, Plane, Plus, Receipt, Repeat, ShoppingCart, Swords, Table2, Trash2, Wallet, ScrollText, CalendarDays, ChevronRight,
} from 'lucide-react';
import { useData, selectRowsForTable, stableRowKey } from '../store/useData';
import { useMembers } from '../hooks/useMembers';
import type { Column, TableData, TableRow } from '../types';
import { cellDisplay } from './CustomCardBlock';
import { initials, avatarColor } from '../lib/avatar';
import {
  columnNamed, daysFrom, formulaReady, dueTone, groupRows, isBlankRow, nextActive, nightsBetween, relativeDays, sortForWidget, weightedPick,
  type WidgetKind, type WidgetSpec,
} from '../lib/tableWidgets';
import { formatDateTime } from '../lib/tableQuery';
import { cellNumber } from '../lib/scope';
import { formatValue } from '../lib/formula';
import {
  addRowButton, faint, iconButton, itemRow, primaryButton, quietButton, sectionLabel, widgetBody, widgetCard, widgetHeader, widgetIcon,
  widgetMeta, widgetTitle,
} from './widgetStyle';

const ICONS: Record<WidgetKind, typeof Wallet> = {
  accommodation: BedDouble,
  authority: BookMarked,
  lecture: GraduationCap,
  bills: Receipt,
  deadlines: CalendarClock,
  meals: ChefHat,
  groceries: ShoppingCart,
  family: Home,
  packing: Luggage,
  routine: Repeat,
  budget: Wallet,
  rolltable: Dices,
  combat: Swords,
  journal: NotebookPen,
  itinerary: MapIcon,
  transport: Plane,
  schedule: CalendarDays,
  campaign: ScrollText,
};

const TONE: Record<string, string> = {
  late: 'bg-rose-500/10 text-rose-500',
  soon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  later: 'bg-paper-panel text-ink-soft dark:bg-coal-line dark:text-coal-soft',
  done: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

export function WidgetShell({
  spec,
  name,
  meta,
  onShowTable,
  tools,
  children,
}: {
  spec: WidgetSpec;
  name: string;
  meta?: string;
  onShowTable: () => void;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const Icon = ICONS[spec.kind];
  return (
    <div className={widgetCard} data-table-widget={spec.kind}>
      <div className={widgetHeader}>
        <Icon className={widgetIcon} />
        <span className={widgetTitle}>{name && name !== 'Untitled table' ? name : spec.label}</span>
        {meta && <span className={widgetMeta}>{meta}</span>}
        {tools}
        <button type="button" onClick={onShowTable} className={iconButton} title="Show as a table" aria-label="Show as a table">
          <Table2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function Badge({ label, color }: { label: string; color?: string }) {
  if (!label) return null;
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-ink-soft dark:text-coal-soft"
      style={color ? { backgroundColor: `${color}26` } : undefined}
    >
      {label}
    </span>
  );
}

function Avatars({ ids, names }: { ids: string[]; names: Map<string, string> }) {
  if (!ids.length) return null;
  return (
    <span className="flex shrink-0 -space-x-1">
      {ids.slice(0, 3).map((id) => (
        <span
          key={id}
          title={names.get(id) ?? ''}
          className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white ring-1 ring-paper dark:ring-coal"
          style={{ backgroundColor: avatarColor(id) }}
        >
          {initials(names.get(id) ?? '?')}
        </span>
      ))}
    </span>
  );
}

function optionColor(col: Column | undefined, row: TableRow): string | undefined {
  if (!col || (col.type !== 'select' && col.type !== 'multiselect')) return undefined;
  const v = row.cells[col.id];
  const id = Array.isArray(v) ? v[0] : v;
  return (col.options ?? []).find((o) => o.id === id)?.color;
}

function DateChip({
  column,
  value,
  editable,
  onChange,
  className,
  label,
}: {
  column: Column;
  value: unknown;
  editable: boolean;
  onChange: (v: string) => void;
  className: string;
  label: string;
}) {
  const withTime = column.type === 'datetime' || column.type === 'reminder';
  const raw = typeof value === 'string' ? value : '';
  const inputValue = withTime ? raw.replace(' ', 'T').slice(0, 16) : raw.slice(0, 10);
  return (
    <span className={`relative shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
      {editable && (
        <input
          type={withTime ? 'datetime-local' : 'date'}
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${column.name} date`}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      )}
    </span>
  );
}

export function TableWidget({ tableId, spec, editable, onShowTable }: { tableId: string; spec: WidgetSpec; editable: boolean; onShowTable: () => void }) {
  const table = useData((s) => s.tables[tableId]);
  const rowsMap = useData((s) => s.rows);
  const tables = useData((s) => s.tables);
  const members = useMembers();
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const allRows = useMemo(() => selectRowsForTable(rowsMap, tableId).filter((r) => !r.parent), [rowsMap, tableId]);
  if (!table) return null;
  return (
    <WidgetBody
      tableId={tableId}
      table={table}
      rows={allRows}
      spec={spec}
      editable={editable}
      onShowTable={onShowTable}
      show={(row, col) => cellDisplay(table, row, col, tables, rowsMap, members)}
      names={names}
    />
  );
}

function WidgetBody({
  tableId,
  table,
  rows,
  spec,
  editable,
  onShowTable,
  show,
  names,
}: {
  tableId: string;
  table: TableData;
  rows: TableRow[];
  spec: WidgetSpec;
  editable: boolean;
  onShowTable: () => void;
  show: (row: TableRow, col: Column | undefined) => string;
  names: Map<string, string>;
}) {
  const setCell = useData((s) => s.setCell);
  const rowsMap = useData((s) => s.rows);
  const addRow = useData((s) => s.addRow);
  const deleteRow = useData((s) => s.deleteRow);
  const openRow = useData((s) => s.openRow);
  const [rolled, setRolled] = useState<string | null>(null);
  const cols = table.columns;
  const col = (n: string | undefined) => columnNamed(cols, n);
  const titleCol = col(spec.title);
  const checkCol = col(spec.check);
  const groupCol = col(spec.group);
  const dueCol = col(spec.due);
  const whenCol = col(spec.when);
  const untilCol = col(spec.until);
  const amountCol = col(spec.amount);
  const currencyCol = col(spec.currency);
  const totalCol = col(spec.total);
  const peopleCol = col(spec.people);
  const linkCol = col(spec.link);
  const subCols = (spec.sub ?? []).map(col).filter((c): c is Column => !!c);
  const badgeCols = (spec.badges ?? []).map(col).filter((c): c is Column => !!c);
  const statCols = (spec.stats ?? []).map(col).filter((c): c is Column => !!c);
  const combat = spec.combat
    ? { init: col(spec.combat.init), hp: col(spec.combat.hp), max: col(spec.combat.max), active: col(spec.combat.active), conditions: col(spec.combat.conditions) }
    : null;
  const roll = spec.roll ? { weight: col(spec.roll.weight), range: col(spec.roll.range) } : null;

  const visible = useMemo(() => {
    return sortForWidget(rows, spec, cols);
  }, [rows, cols, spec]);

  const done = checkCol ? visible.filter((r) => r.cells[checkCol.id] === true).length : 0;
  const meta = useMemo(() => {
    const n = visible.filter((r) => !isBlankRow(r, cols)).length;
    if (spec.kind === 'accommodation' && whenCol && untilCol) {
      const nights = visible.reduce((a, r) => a + nightsBetween(r.cells[whenCol.id], r.cells[untilCol.id]), 0);
      if (!n) return '';
      return `${n} ${n === 1 ? 'stay' : 'stays'}${nights ? ` · ${nights} ${nights === 1 ? 'night' : 'nights'}` : ''}`;
    }
    if (spec.kind === 'budget' && totalCol) {
      const sum = visible.reduce((a, r) => a + (formulaReady(totalCol, r, cols) ? cellNumber(table, r, totalCol, rowsMap) ?? 0 : 0), 0);
      return sum ? `${formatValue(sum, totalCol.numberFormat ?? 'plain')} total` : n ? `${n} ${n === 1 ? 'expense' : 'expenses'}` : '';
    }
    if (spec.kind === 'bills' && checkCol) {
      const open = visible.filter((r) => !isBlankRow(r, cols) && r.cells[checkCol.id] !== true).length;
      return open ? `${open} to pay` : n ? 'all paid' : '';
    }
    if (spec.kind === 'deadlines' && dueCol) {
      const next = visible.map((r) => daysFrom(r.cells[dueCol.id])).filter((d): d is number => d != null && d >= 0).sort((a, b) => a - b)[0];
      return next != null ? `next ${relativeDays(next)}` : '';
    }
    if (checkCol) {
      const word = spec.kind === 'packing' ? 'packed' : spec.kind === 'groceries' ? 'in the basket' : spec.kind === 'routine' ? 'done today' : spec.kind === 'meals' ? 'cooked' : spec.kind === 'authority' ? 'read' : 'done';
      return n ? `${done}/${n} ${word}` : '';
    }
    return n ? `${n} ${n === 1 ? spec.noun : spec.noun + 's'}` : '';
  }, [visible, cols, spec, whenCol, untilCol, totalCol, checkCol, dueCol, done, table, rowsMap]);

  const add = (groupId?: string) => {
    const cells: Record<string, string | string[]> = {};
    if (groupCol && groupId) cells[groupCol.id] = groupCol.type === 'multiselect' ? [groupId] : groupId;
    void addRow(tableId, cells);
  };

  const doRoll = () => {
    const pick = weightedPick(visible.filter((r) => !isBlankRow(r, cols)), roll?.weight);
    setRolled(pick?.id ?? null);
  };

  const removeRow = (row: TableRow) => {
    void deleteRow(row.id);
  };

  const nextTurn = () => {
    if (!combat?.active) return;
    const { off, on } = nextActive(visible, combat.active);
    for (const id of off) setCell(id, combat.active.id, false);
    if (on) setCell(on, combat.active.id, true);
  };

  const named = visible.filter((r) => !isBlankRow(r, cols)).length;
  const progress = checkCol && named > 0 && (spec.kind === 'packing' || spec.kind === 'groceries' || spec.kind === 'routine');
  const pct = progress ? Math.round((done / named) * 100) : 0;

  const tools = (
    <>
      {roll && (
        <button type="button" onClick={doRoll} className={quietButton}>
          <Dices className="h-3 w-3" /> Roll
        </button>
      )}
      {combat?.active && editable && (
        <button type="button" onClick={nextTurn} className={quietButton}>
          <ChevronRight className="h-3 w-3" /> Next turn
        </button>
      )}
    </>
  );

  const ready = (row: TableRow, c: Column | undefined) => !!c && formulaReady(c, row, cols);
  const renderRow = (row: TableRow) => {
    const blank = isBlankRow(row, cols);
    const title = titleCol ? String(row.cells[titleCol.id] ?? '') : '';
    const checked = checkCol ? row.cells[checkCol.id] === true : false;
    const dueDays = dueCol && ready(row, dueCol) ? daysFrom(row.cells[dueCol.id]) : null;
    const tone = dueCol ? dueTone(dueDays, checked || (spec.pastIsDone === true && dueDays != null && dueDays < 0)) : 'none';
    const subs = subCols.filter((c) => ready(row, c)).map((c) => show(row, c)).filter(Boolean);
    const when = whenCol ? formatDateTime(row.cells[whenCol.id] ?? null) : '';
    const until = untilCol ? formatDateTime(row.cells[untilCol.id] ?? null) : '';
    const amount = amountCol && ready(row, amountCol) ? show(row, amountCol) : '';
    const currency = currencyCol ? show(row, currencyCol) : '';
    const people = peopleCol && Array.isArray(row.cells[peopleCol.id]) ? (row.cells[peopleCol.id] as string[]) : [];
    const link = linkCol ? String(row.cells[linkCol.id] ?? '') : '';
    const isActive = combat?.active ? row.cells[combat.active.id] === true : false;
    const hp = combat?.hp ? Number(row.cells[combat.hp.id]) : NaN;
    const max = combat?.max ? Number(row.cells[combat.max.id]) : NaN;
    const hpPct = Number.isFinite(hp) && Number.isFinite(max) && max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : null;
    const highlighted = rolled === row.id || isActive;

    return (
      <div key={stableRowKey(row.id)} className={[itemRow, 'group flex-wrap', highlighted ? 'bg-clay-wash/60 dark:bg-clay/15' : ''].join(' ')} data-row={row.id}>
        {checkCol && (
          <button
            type="button"
            disabled={!editable}
            onClick={() => setCell(row.id, checkCol.id, !checked)}
            aria-label={checked ? `Untick ${title || spec.noun}` : `Tick ${title || spec.noun}`}
            className={[
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
              checked ? 'border-clay bg-clay text-white' : 'border-paper-line hover:border-clay dark:border-coal-line',
            ].join(' ')}
          >
            {checked && <Check className="h-3 w-3" />}
          </button>
        )}
        {combat?.init && (
          <span className="w-6 shrink-0 text-center font-mono text-xs tabular-nums text-ink-soft dark:text-coal-soft">{show(row, combat.init) || '·'}</span>
        )}
        {roll?.range && (
          <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-ink-soft dark:text-coal-soft">{show(row, roll.range)}</span>
        )}
        <div className="min-w-[7rem] flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {editable && titleCol ? (
              <input
                value={title}
                onChange={(e) => setCell(row.id, titleCol.id, e.target.value)}
                placeholder={`Name this ${spec.noun}…`}
                className={[
                  'min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint/70 dark:placeholder:text-coal-soft/70',
                  checked ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text',
                ].join(' ')}
              />
            ) : (
              <span className={['min-w-0 flex-1 truncate text-sm', checked ? 'text-ink-faint line-through dark:text-coal-soft' : 'text-ink dark:text-coal-text'].join(' ')}>
                {title || `Unnamed ${spec.noun}`}
              </span>
            )}
            {badgeCols.map((c) =>
              c.type === 'checkbox' ? (row.cells[c.id] === true ? <Badge key={c.id} label={c.name} /> : null) : <Badge key={c.id} label={show(row, c)} color={optionColor(c, row)} />,
            )}
            {combat?.conditions && show(row, combat.conditions) && <Badge label={show(row, combat.conditions)} />}
          </div>
          {(subs.length > 0 || when || hpPct != null || (editable && whenCol && whenCol !== dueCol)) && (
            <div className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs ${faint}`}>
              {editable && whenCol && whenCol !== dueCol && whenCol.type !== 'formula' ? (
                <span className="flex shrink-0 items-center gap-1">
                  <DateChip column={whenCol} value={row.cells[whenCol.id]} editable onChange={(v) => setCell(row.id, whenCol.id, v)} className="px-0 text-xs font-normal hover:text-clay" label={when || `Set ${whenCol.name.toLowerCase()}`} />
                  {untilCol && untilCol.type !== 'formula' && (
                    <>
                      <span aria-hidden>→</span>
                      <DateChip column={untilCol} value={row.cells[untilCol.id]} editable onChange={(v) => setCell(row.id, untilCol.id, v)} className="px-0 text-xs font-normal hover:text-clay" label={until || `Set ${untilCol.name.toLowerCase()}`} />
                    </>
                  )}
                </span>
              ) : (
                when && <span className="shrink-0">{until ? `${when} → ${until}` : when}</span>
              )}
              {when && subs.length > 0 && <span aria-hidden>·</span>}
              {subs.length > 0 && <span className="min-w-0 truncate">{subs.join(' · ')}</span>}
              {hpPct != null && (
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-line dark:bg-coal-line">
                    <span className={['block h-full rounded-full', hpPct <= 25 ? 'bg-rose-500' : hpPct <= 50 ? 'bg-amber-500' : 'bg-emerald-500'].join(' ')} style={{ width: `${hpPct}%` }} />
                  </span>
                  <span className="font-mono tabular-nums">{hp}/{max}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {!blank && statCols.map((c) => {
          const v = ready(row, c) ? show(row, c) : '';
          return v && v !== '#ERR' ? (
            <span key={c.id} className="shrink-0 text-right text-[11px] leading-tight text-ink-faint dark:text-coal-soft">
              <span className="block font-mono text-xs tabular-nums text-ink-soft dark:text-coal-soft">{v}</span>
              {c.name.toLowerCase()}
            </span>
          ) : null;
        })}
        {dueCol && dueCol.type !== 'formula' && (dueDays != null || editable) && (
          <DateChip
            column={dueCol}
            value={row.cells[dueCol.id]}
            editable={editable}
            onChange={(v) => setCell(row.id, dueCol.id, v)}
            className={dueDays != null ? TONE[tone] ?? '' : 'text-ink-faint dark:text-coal-soft'}
            label={dueDays == null ? 'Set a date' : tone === 'done' ? formatDateTime(row.cells[dueCol.id] ?? null) : relativeDays(dueDays)}
          />
        )}
        {editable && amountCol?.type === 'number' ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-ink dark:text-coal-text">
            <input
              value={row.cells[amountCol.id] === undefined || row.cells[amountCol.id] === null ? '' : String(row.cells[amountCol.id])}
              onChange={(e) => {
                const raw = e.target.value.replace(',', '.').trim();
                setCell(row.id, amountCol.id, raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : raw);
              }}
              inputMode="decimal"
              placeholder="0"
              aria-label={`Amount for ${title || spec.noun}`}
              className="w-16 rounded bg-transparent px-1 text-right outline-none placeholder:text-ink-faint/60 hover:bg-paper-panel focus:bg-paper dark:hover:bg-coal-line dark:focus:bg-coal-panel"
            />
            {currencyCol?.type === 'select' ? (
              <select
                value={typeof row.cells[currencyCol.id] === 'string' ? (row.cells[currencyCol.id] as string) : ''}
                onChange={(e) => setCell(row.id, currencyCol.id, e.target.value)}
                aria-label={`Currency for ${title || spec.noun}`}
                className="cursor-pointer appearance-none rounded bg-transparent px-0.5 text-ink-faint outline-none hover:bg-paper-panel hover:text-clay dark:text-coal-soft dark:hover:bg-coal-line"
              >
                <option value="" hidden>{(currencyCol.options ?? [])[0]?.label ?? ''}</option>
                {(currencyCol.options ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            ) : (
              currency && <span className="text-ink-faint dark:text-coal-soft">{currency}</span>
            )}
          </span>
        ) : amount && amount !== '#ERR' && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink dark:text-coal-text">
            {amount}
            {currency && !/[^\d\s.,-]/.test(amount) ? ` ${currency}` : ''}
          </span>
        )}
        <Avatars ids={people} names={names} />
        {link && /^https?:\/\//i.test(link) && (
          <a href={link} target="_blank" rel="noreferrer" className={iconButton} title="Open the link" aria-label="Open the link">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button type="button" onClick={() => openRow(row.id)} className={`${iconButton} hidden focus:opacity-100 sm:inline-flex sm:opacity-0 sm:group-hover:opacity-100`} title="Open" aria-label={`Open ${title || spec.noun}`}>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {editable && (
          <button
            type="button"
            onClick={() => removeRow(row)}
            className="rounded-md p-1.5 text-ink-faint hover:text-rose-500 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:text-coal-soft"
            title="Remove"
            aria-label={`Remove ${title || spec.noun}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        </div>
      </div>
    );
  };

  const grouped = groupCol ? groupRows(visible, groupCol) : [];
  const groups = grouped.length > 1 || grouped.some((g) => g.id) ? grouped : [{ id: '', label: '', color: undefined, rows: visible }];

  return (
    <WidgetShell spec={spec} name={table.name} meta={meta} onShowTable={onShowTable} tools={tools}>
      {progress && (
        <div className="px-3 pt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-line dark:bg-coal-line">
            <div className="h-full rounded-full bg-clay transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className={`${widgetBody} space-y-2`}>
        {rolled && roll && (
          <div className="flex items-center gap-2 rounded-lg bg-clay-wash/60 px-3 py-2 text-sm text-ink dark:bg-clay/15 dark:text-coal-text">
            <Dices className="h-4 w-4 shrink-0 text-clay" />
            <span className="min-w-0 flex-1">{titleCol ? String(rows.find((r) => r.id === rolled)?.cells[titleCol.id] ?? '') : ''}</span>
            <button type="button" onClick={doRoll} className={primaryButton}>Roll again</button>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.id || 'all'}>
            {g.label && (
              <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1">
                {g.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color }} />}
                <span className={sectionLabel}>{g.label}</span>
                {checkCol && (
                  <span className={`text-[11px] ${faint}`}>
                    {g.rows.filter((r) => r.cells[checkCol.id] === true).length}/{g.rows.length}
                  </span>
                )}
                {editable && g.id && (
                  <button type="button" onClick={() => add(g.id)} className={`${iconButton} ml-auto p-1`} title={`Add to ${g.label}`} aria-label={`Add to ${g.label}`}>
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            <div className="space-y-0.5">{g.rows.map(renderRow)}</div>
          </div>
        ))}
        {visible.length === 0 && <p className={`px-2 py-1 text-sm ${faint}`}>Nothing here yet. Add the first {spec.noun} below.</p>}
        {editable && (
          <button type="button" onClick={() => add()} className={addRowButton}>
            <Plus className="h-3.5 w-3.5" /> Add {/^[aeiou]/.test(spec.noun) ? 'an' : 'a'} {spec.noun}
          </button>
        )}
      </div>
    </WidgetShell>
  );
}
