import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Plus } from 'lucide-react';
import { useData } from '../store/useData';
import type { Column, GeoValue, TableData, TableRow } from '../types';
import { titleColumn, cellText, geoOf, type ViewConfig } from '../lib/tableQuery';
import { parseDateTime, layoutDay, clashes, daysWithEvents, minutesToLabel, type SEvent } from '../lib/schedule';
import { useForecasts } from '../hooks/useForecast';

// ScheduleView, a single day on an hour grid. Rows land by their start time and
// stretch to their end (or a default hour); overlapping items split into columns
// like a calendar app, double-bookings raise a banner, and the empty bands
// between consecutive items are labelled with the gap (your layover).

const DEFAULT_MIN = 60; // length of an event with no end time
const PX_PER_MIN = 48 / 60; // 48px per hour
const DAY_MIN = 1440;

function fmtDay(dayIso: string): string {
  const [y, m, d] = dayIso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' });
}
function gapLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}
function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function ScheduleView({
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
  const startCol: Column | undefined = table.columns.find((c) => c.id === view.startTimeColumnId && c.type === 'datetime');
  const endCol: Column | undefined = table.columns.find((c) => c.id === view.endTimeColumnId && c.type === 'datetime');
  const title = titleColumn(table.columns);
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
  const days = useMemo(
    () => (startCol ? daysWithEvents(rows.map((r) => r.cells[startCol.id])) : []),
    [rows, startCol],
  );
  const [day, setDay] = useState<string>(() => days[0] ?? todayIso());
  const cursor = days.includes(day) ? day : (day || days[0] || todayIso());

  if (!startCol) {
    return (
      <div className="p-6 text-center text-sm text-ink-faint dark:text-coal-soft">
        Pick a <span className="font-medium">Start</span> date &amp; time column in the toolbar to lay out the day.
        <br />
        Don&rsquo;t have one? Add a Date &amp; time column in the Grid view first.
      </div>
    );
  }

  // Build the day's events (timed go on the grid; date-only sit in an all-day strip).
  const timed: (SEvent & { allDay: false })[] = [];
  const allDay: { rowId: string; label: string }[] = [];
  for (const r of rows) {
    const p = parseDateTime(r.cells[startCol.id]);
    if (!p || p.dayIso !== cursor) continue;
    const label = (title ? cellText(r.cells[title.id] ?? null, title) : '') || 'Untitled';
    if (!p.hasTime) {
      allDay.push({ rowId: r.id, label });
      continue;
    }
    const ep = endCol ? parseDateTime(r.cells[endCol.id]) : null;
    let endMin = p.minutes + DEFAULT_MIN;
    if (ep) endMin = ep.dayIso > cursor ? DAY_MIN : Math.max(p.minutes + 15, ep.minutes);
    timed.push({ rowId: r.id, label, startMin: p.minutes, endMin: Math.min(endMin, DAY_MIN), allDay: false });
  }

  const placed = layoutDay(timed);
  const collisions = clashes(timed);

  // Visible hour window: pad around the day's events, default 07:00–22:00.
  const earliest = timed.length ? Math.min(...timed.map((e) => e.startMin)) : 7 * 60;
  const latest = timed.length ? Math.max(...timed.map((e) => e.endMin)) : 22 * 60;
  const startHour = Math.max(0, Math.min(7, Math.floor(earliest / 60)));
  const endHour = Math.min(24, Math.max(22, Math.ceil(latest / 60)));
  const top0 = startHour * 60;
  const gridHeight = (endHour - startHour) * 60 * PX_PER_MIN;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  // Gaps between consecutive non-overlapping events, the layover annotations.
  const ordered = [...timed].sort((a, b) => a.startMin - b.startMin);
  const gaps: { top: number; height: number; mins: number }[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const gap = ordered[i + 1].startMin - ordered[i].endMin;
    if (gap >= 20) gaps.push({ top: (ordered[i].endMin - top0) * PX_PER_MIN, height: gap * PX_PER_MIN, mins: gap });
  }

  const dayGeo = placeCol
    ? rows
        .map((r) => {
          const p = parseDateTime(r.cells[startCol.id]);
          return p && p.dayIso === cursor ? geoOf(r.cells[placeCol.id]) : null;
        })
        .find((g): g is GeoValue => !!g)
    : undefined;
  const dayW = dayGeo ? weatherAt(dayGeo.lat, dayGeo.lon, cursor) : null;

  const stepDay = (delta: number) => {
    const [y, m, d] = cursor.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    setDay(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
  };
  const addAt = (hour: number) => {
    void addRow(tableId, { [startCol.id]: `${cursor}T${String(hour).padStart(2, '0')}:00` }).then((id) => id && openRow(id));
  };

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => stepDay(-1)} className="rounded-md p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[8rem] text-center text-sm font-semibold text-ink dark:text-coal-text sm:min-w-[12rem]">{fmtDay(cursor)}</span>
        {dayW && (
          <span className="inline-flex items-center gap-1 rounded-full bg-paper-panel px-2 py-0.5 text-[11px] text-ink-soft dark:bg-coal-line dark:text-coal-soft" title={dayW.label}>
            {dayW.emoji} {dayW.hi}° / {dayW.lo}°
          </span>
        )}
        <button type="button" onClick={() => stepDay(1)} className="rounded-md p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setDay(todayIso())} className="ml-1 rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
          Today
        </button>
        {days.length > 0 && (
          <span className="ml-auto text-[11px] text-ink-faint dark:text-coal-soft">{days.length} day{days.length === 1 ? '' : 's'} with entries</span>
        )}
      </div>

      {collisions.length > 0 && (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-clay/40 bg-clay-wash px-2.5 py-1.5 text-[11px] text-clay dark:bg-clay/15 dark:text-clay-soft">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {collisions.map(([a, b], i) => (
              <span key={i} className="mr-2 inline-block">
                {a.label} ({minutesToLabel(a.startMin)}) overlaps {b.label} ({minutesToLabel(b.startMin)})
              </span>
            ))}
          </span>
        </div>
      )}

      {allDay.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {allDay.map((e) => (
            <button
              key={e.rowId}
              type="button"
              onClick={() => openRow(e.rowId)}
              className="truncate rounded bg-paper-panel px-2 py-1 text-[11px] text-ink-soft hover:bg-clay-wash hover:text-clay dark:bg-coal-line dark:text-coal-soft"
              title="all day"
            >
              {e.label}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-paper-line dark:border-coal-line">
        <div className="relative flex">
          {/* Hour gutter */}
          <div className="w-14 shrink-0 border-r border-paper-line dark:border-coal-line">
            {hours.map((h) => (
              <div key={h} style={{ height: 60 * PX_PER_MIN }} className="relative">
                <span className="absolute -top-1.5 right-1.5 text-[10px] text-ink-faint dark:text-coal-soft">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {/* Day column */}
          <div className="relative flex-1" style={{ height: gridHeight }}>
            {/* Hour lines + click-to-add */}
            {hours.map((h, i) => (
              <button
                key={h}
                type="button"
                onClick={() => addAt(h)}
                style={{ top: i * 60 * PX_PER_MIN, height: 60 * PX_PER_MIN }}
                className="group/hour absolute inset-x-0 border-t border-paper-line/70 text-left dark:border-coal-line/60"
              >
                <Plus className="invisible absolute left-1 top-1 h-3 w-3 text-ink-faint group-hover/hour:visible" />
              </button>
            ))}

            {/* Gap (layover) labels */}
            {gaps.map((g, i) =>
              g.height >= 22 ? (
                <div
                  key={i}
                  style={{ top: g.top, height: g.height }}
                  className="pointer-events-none absolute inset-x-0 flex items-center justify-center"
                >
                  <span className="rounded-full bg-paper-panel px-1.5 py-0.5 text-[9px] text-ink-faint dark:bg-coal-line dark:text-coal-soft">{gapLabel(g.mins)} gap</span>
                </div>
              ) : null,
            )}

            {/* Events */}
            {placed.map((e) => {
              const width = `calc(${100 / e.cols}% - 4px)`;
              const left = `calc(${(100 / e.cols) * e.col}% + 2px)`;
              const top = (e.startMin - top0) * PX_PER_MIN;
              const height = Math.max(20, (e.endMin - e.startMin) * PX_PER_MIN - 2);
              return (
                <button
                  key={e.rowId}
                  type="button"
                  onClick={() => openRow(e.rowId)}
                  style={{ top, height, left, width }}
                  className="absolute overflow-hidden rounded-md border border-clay/40 bg-clay-wash px-1.5 py-1 text-left text-[11px] leading-tight text-clay hover:bg-clay/20 dark:bg-clay/15 dark:text-clay-soft"
                  title={e.label}
                >
                  <span className="block truncate font-medium">{e.label}</span>
                  <span className="block truncate text-[10px] opacity-80">
                    {minutesToLabel(e.startMin)}–{minutesToLabel(e.endMin)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {timed.length === 0 && allDay.length === 0 && (
        <p className="mt-2 text-center text-xs text-ink-faint dark:text-coal-soft">
          Nothing on {fmtDay(cursor)}, click an hour to add an entry.
        </p>
      )}
    </div>
  );
}
