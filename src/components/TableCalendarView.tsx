import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useData } from '../store/useData';
import type { Column, GeoValue, TableData, TableRow } from '../types';
import { rowTitle, rowColor, spansDay, geoOf, rowIcon, type ViewConfig } from '../lib/tableQuery';
import { isImageIcon } from '../lib/pageIcon';
import { useAuth } from '../store/useAuth';
import { useForecasts } from '../hooks/useForecast';
import { useRowNavSource } from '../hooks/useRowNavSource';

// CalendarView, places rows on a month grid by a "From" date column, spanning
// to an optional "To" date. Click an entry to open it as a page; the per-day +
// creates an entry on that day and opens it.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function toDayIndex(isoLike: string): number {
  const [y, m, d] = isoLike.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function addDaysIso(isoLike: string, delta: number): string {
  const dt = new Date((toDayIndex(isoLike) + delta) * 86400000);
  const day = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  return day + isoLike.slice(10); // keep any time-of-day suffix (a datetime cell), '' for a plain date
}

// Module-scoped drag handoff (one drag at a time).
let pendingCalDrag: { rowId: string; startIso: string; endIso: string | null; grabbedIso: string } | null = null;

export function CalendarView({
  tableId,
  table,
  rows,
  view,
}: {
  tableId: string;
  table: TableData;
  rows: TableRow[];
  view: ViewConfig;
}) {
  const addRow = useData((s) => s.addRow);
  const openRow = useData((s) => s.openRow);
  const setCell = useData((s) => s.setCell);
  const [dragOverIso, setDragOverIso] = useState<string | null>(null);
  const isDateish = (c: Column) => c.type === 'date' || c.type === 'datetime';
  const startCol: Column | undefined = table.columns.find((c) => c.id === view.dateColumnId && isDateish(c));
  const endCol: Column | undefined = table.columns.find((c) => c.id === view.endDateColumnId && isDateish(c));
  const placeCol = table.columns.find((c) => c.id === view.placeColumnId && c.type === 'place') ?? table.columns.find((c) => c.type === 'place');
  const places = useMemo(
    () =>
      placeCol
        ? rows
            .map((r) => geoOf(r.cells[placeCol.id]))
            .filter((g): g is GeoValue => !!g)
            .map((g) => ({ lat: g.lat, lon: g.lon }))
        : [],
    [rows, placeCol],
  );
  const weatherAt = useForecasts(places);

  const startOf = (r: TableRow): string | null => {
    if (!startCol) return null;
    const v = r.cells[startCol.id];
    return typeof v === 'string' && v ? v : null;
  };
  const endOf = (r: TableRow): string | null => {
    if (!endCol) return null;
    const v = r.cells[endCol.id];
    return typeof v === 'string' && v ? v : null;
  };

  // Where the calendar opens: a pinned default month if set, else the first
  // dated row's month, else today.
  const initial = useMemo(() => {
    if (view.defaultMonth && /^\d{4}-\d{2}$/.test(view.defaultMonth)) {
      const [yy, mm] = view.defaultMonth.split('-').map(Number);
      return { y: yy, m: mm - 1 };
    }
    const firstDated = rows.map(startOf).find((v): v is string => typeof v === 'string');
    const base = firstDated ? new Date(firstDated.slice(0, 10) + 'T00:00:00') : new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCol, rows, view.defaultMonth]);

  const [cursor, setCursor] = useState(initial);

  // Jump to the pinned month whenever it is set or changed.
  useEffect(() => {
    if (view.defaultMonth && /^\d{4}-\d{2}$/.test(view.defaultMonth)) {
      const [yy, mm] = view.defaultMonth.split('-').map(Number);
      setCursor({ y: yy, m: mm - 1 });
    }
  }, [view.defaultMonth]);

  // With an entry's drawer open, left/right jump to the previous/next day that
  // has entries and up/down walk that day's stack; the grid follows the month.
  // A spanning row sits in every day it covers (capped so a typo'd end date
  // can't build a thousand lanes); rowNav steps over its own duplicates.
  useRowNavSource(
    () => {
      if (!startCol) return [];
      const byDay = new Map<string, string[]>();
      for (const r of rows) {
        const s = startOf(r);
        if (!s) continue;
        const e = endOf(r);
        const from = toDayIndex(s);
        const span = e ? Math.min(Math.max(toDayIndex(e) - from, 0), 366) : 0;
        for (let d = 0; d <= span; d++) {
          const key = addDaysIso(s, d);
          const arr = byDay.get(key) ?? [];
          arr.push(r.id);
          byDay.set(key, arr);
        }
      }
      return [...byDay.keys()].sort().map((k) => byDay.get(k)!);
    },
    (rowId) => {
      const r = rows.find((x) => x.id === rowId);
      const s = r ? startOf(r) : null;
      if (!s) return;
      const [yy, mm] = s.slice(0, 10).split('-').map(Number);
      setCursor((cur) => (cur.y === yy && cur.m === mm - 1 ? cur : { y: yy, m: mm - 1 }));
    },
  );

  // Read BEFORE the early return below. A hook after it runs on some renders
  // and not others, and React counts hooks: picking a From date column would
  // change the count mid-life and throw.
  const myId = useAuth((s) => s.user?.id ?? '');

  if (!startCol) {
    return (
      <div className="p-6 text-center text-sm text-ink-faint dark:text-coal-soft">
        Pick a <span className="font-medium">From</span> date column for the calendar (top-left of the toolbar).
        <br />
        Don&rsquo;t have one? Add a Date column in the Grid view first.
      </div>
    );
  }

  const { y, m } = cursor;
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthLabel = new Date(y, m, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const step = (delta: number) => {
    const nm = m + delta;
    setCursor({ y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 });
  };

  const todayIso = iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const addOnDay = (dayIso: string) => {
    void addRow(tableId, { [startCol.id]: dayIso }).then((id) => {
      if (id) openRow(id);
    });
  };

  const handleDrop = (dayIso: string) => {
    const d = pendingCalDrag;
    pendingCalDrag = null;
    setDragOverIso(null);
    if (!d || !startCol) return;
    const delta = toDayIndex(dayIso) - toDayIndex(d.grabbedIso);
    if (delta === 0) return;
    setCell(d.rowId, startCol.id, addDaysIso(d.startIso, delta));
    if (endCol && d.endIso) setCell(d.rowId, endCol.id, addDaysIso(d.endIso, delta));
  };

  const firstDay = rows.map(startOf).filter((v): v is string => !!v).map((v) => v.slice(0, 10)).sort()[0];

  // Conditional-format rules with the @me sentinel resolved, so a card's tint
  // matches the grid's. Cheap; computed per render.
  const rawRules = view.colorRules;
  const colorRules = rawRules?.some((r) => r.value === '@me') ? rawRules.map((r) => (r.value === '@me' ? { ...r, value: myId } : r)) : rawRules;

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => step(-1)} className="rounded-md p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[8rem] text-center text-sm font-semibold text-ink dark:text-coal-text sm:min-w-[10rem]">{monthLabel}</span>
        <button type="button" onClick={() => step(1)} className="rounded-md p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setCursor({ y: new Date().getFullYear(), m: new Date().getMonth() })}
          className="ml-1 rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"
        >
          Today
        </button>
        {firstDay && (
          <button
            type="button"
            onClick={() => { const [y, m] = firstDay.split('-').map(Number); setCursor({ y, m: m - 1 }); }}
            className="rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line"
            title={`Jump to the first item (${firstDay})`}
          >
            First item
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-paper-line bg-paper-line dark:border-coal-line dark:bg-coal-line">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-paper-panel px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:bg-coal-panel dark:text-coal-soft">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const dayIso = day ? iso(y, m, day) : '';
          const dayRows = day ? rows.filter((r) => spansDay(startOf(r), endOf(r), dayIso)) : [];
          const dayGeo = day && placeCol ? dayRows.map((r) => geoOf(r.cells[placeCol.id])).find((g): g is GeoValue => !!g) : undefined;
          const w = dayGeo ? weatherAt(dayGeo.lat, dayGeo.lon, dayIso) : null;
          return (
            <div
              key={i}
              onDragOver={(e) => {
                if (pendingCalDrag && day !== null) {
                  e.preventDefault();
                  setDragOverIso(dayIso);
                }
              }}
              onDragLeave={() => setDragOverIso((d) => (d === dayIso ? null : d))}
              onDrop={() => handleDrop(dayIso)}
              className={[
                'group/day min-h-[88px] p-1 align-top',
                day === null ? 'bg-paper opacity-40 dark:bg-coal-panel' : i % 7 >= 5 ? 'bg-clay-wash/30 dark:bg-clay/10' : 'bg-paper dark:bg-coal-panel',
                dragOverIso === dayIso ? 'ring-2 ring-inset ring-clay' : '',
              ].join(' ')}
            >
              {day !== null && (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={[
                        'text-[11px]',
                        dayIso === todayIso
                          ? 'flex h-5 w-5 items-center justify-center rounded-full bg-clay font-semibold text-white'
                          : 'text-ink-faint dark:text-coal-soft',
                      ].join(' ')}
                    >
                      {day}
                    </span>
                    {w && (
                      <span
                        className="ml-1 mr-auto inline-flex items-center gap-0.5 text-[10px] text-ink-faint dark:text-coal-soft"
                        title={`${w.label} · ${w.hi}° / ${w.lo}°`}
                      >
                        {w.emoji} {w.hi}°
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => addOnDay(dayIso)}
                      className="invisible rounded p-0.5 text-ink-faint hover:bg-paper-panel hover:text-clay group-hover/day:visible dark:hover:bg-coal-line"
                      title="Add an entry on this day"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayRows.map((r) => {
                      const label = rowTitle(r.cells, table.columns) || 'Untitled';
                      const ic = rowIcon(r);
                      const s = startOf(r);
                      // Show the time only on the day the item STARTS (a spanning
                      // row shouldn't repeat its start time on every covered day).
                      const time = s && s.slice(0, 10) === dayIso ? /[T ](\d{2}:\d{2})/.exec(s)?.[1] : undefined;
                      const tint = rowColor(r.cells, colorRules);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          draggable={!!s}
                          onDragStart={() => {
                            if (s) pendingCalDrag = { rowId: r.id, startIso: s, endIso: endOf(r), grabbedIso: dayIso };
                          }}
                          onClick={() => openRow(r.id)}
                          className="flex cursor-grab items-center gap-1 truncate rounded bg-clay-wash px-1.5 py-0.5 text-left text-[11px] text-clay hover:bg-clay/20 active:cursor-grabbing dark:bg-clay/15 dark:text-clay-soft"
                          style={tint ? { boxShadow: `inset 3px 0 0 ${tint}` } : undefined}
                          title={`${time ? time + ' ' : ''}${label}`}
                        >
                          {time && <span className="shrink-0 font-mono opacity-70">{time}</span>}
                          {ic &&
                            (isImageIcon(ic) ? (
                              <img src={ic} alt="" className="h-3 w-3 shrink-0 rounded-sm object-contain" />
                            ) : (
                              <span className="shrink-0 leading-none">{ic}</span>
                            ))}
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
