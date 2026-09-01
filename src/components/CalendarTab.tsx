import { Fragment, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Eye, EyeOff, Plus } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { useMembers } from '../hooks/useMembers';
import { collectEvents, collectEventSpans, collectReservationEvents, pageTables } from '../lib/tripViews';
import { useDayAdd } from '../hooks/useDayAdd';
import { DayAddMenu } from './DayAddMenu';
import { useRowNavSource } from '../hooks/useRowNavSource';
import { monthMatrix } from '../lib/sharedTable';
import { initials, avatarColor } from '../lib/avatar';
import { AddToCalendarButton } from './AddToCalendarButton';
import { LockedBodyStrip } from './LockedBody';
import { isEnvelope } from '../lib/crypto';
import type { CalEvent } from '../lib/ics';
import type { PresenceRecord } from '../types';

// CalendarTab, a month grid of this page's dated rows (from the tables embedded
// on it, plus its kanban board). Navigate months; click an event to open its
// row. Monday-first, like the table calendar view.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function addDaysIso(dayIso: string, delta: number): string {
  const d = new Date(`${dayIso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where a calendar chip sits in its row's day range: a lone day, or the
 *  start / middle / end of a multi-day bar. */
type Edge = 'only' | 'start' | 'mid' | 'end';

type Mode = 'month' | 'week' | 'day';

/** The Monday of the week a day falls in. Monday-first, like the rest of the app. */
function startOfWeek(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  return addDaysIso(dayIso, -dow);
}

/** The hour an event starts, or null for an all-day (plain date) item. Week and day
 *  views lay timed things out on an hour rail; undated-in-time items sit above it. */
function hourOf(dateIso: string): number | null {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):/.exec(dateIso);
  return m ? Number(m[1]) : null;
}

/** Which date column a chip came from. TripEvent.key is documented as
 *  `rowId:columnId`, and that pair is exactly what a move has to write back to. */
function colIdOf(key: string): string {
  const at = key.indexOf(':');
  return at === -1 ? '' : key.slice(at + 1);
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

function dayHeading(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00`);
  return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

// "No source filter" is null, not a sentinel string: a sentinel would share a
// namespace with real table names, which is the __default__ / __home__ smell the
// repo is already trying to get rid of.

const chip = (on: boolean) =>
  [
    'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
    on
      ? 'border-clay/40 bg-clay/15 text-clay'
      : 'border-paper-line text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line',
  ].join(' ');

export function CalendarTab({ pageId, presence, body }: { pageId: string; presence?: Map<string, PresenceRecord[]>; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  // Encrypted pages keep an envelope in the store; PageView passes the decrypted body.
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const allTables = useWorkspaceTables();
  const rows = useData((s) => s.rows);
  const members = useMembers();
  const openRow = useData((s) => s.openRow);

  // Body unreadable (encrypted page, vault not open yet): say so. Everything below
  // derives from the body, so without it this renders an empty month grid with no
  // add controls and looks like the calendar broke rather than like it is locked.
  const unreadable = isEnvelope(stored?.content) && !body;

  const tables = useMemo(() => pageTables(page, allTables), [page, allTables]);
  // Dated table rows PLUS dated reservations from the /reservations widget in the
  // page body, merged into one date-sorted list so bookings show on the calendar too.
  const events = useMemo(
    () => [...collectEvents(tables, rows, members), ...collectReservationEvents(page)].sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : 0)),
    [tables, rows, members, page],
  );
  // A row with a recognised From/To pair spans its whole range visually: the
  // From event stretches into a bar over every covered day and the To event is
  // folded into it (it was the same stay shown as a second lone chip). Rows
  // without a knowable pair keep the one-chip-per-date behaviour.
  const spans = useMemo(() => collectEventSpans(tables, rows), [tables, rows]);

  // Controls. A trip page usually carries several tables (flights, stays, food) plus
  // the reservation widget, and one month grid holding all of them at once is the
  // thing that made this hard to read. Filter to one source, and drop what's done.
  const [source, setSource] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);

  // Drag an event onto another day to move it. Writes the SAME cell the chip was
  // read from, preserving a datetime's time-of-day so dragging a 14:00 booking to
  // Thursday keeps 14:00 (stripping it was the old table-calendar bug). setCell
  // handles encryption and refuses a row whose cells are still ciphertext, so this
  // inherits both guards rather than reimplementing them.
  const setCell = useData((s) => s.setCell);
  const [dragging, setDragging] = useState<{ rowId: string; colId: string; from: string } | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const dropOn = (dayIso: string) => {
    const d = dragging;
    setDragging(null);
    setOverDay(null);
    if (!d || d.from === dayIso) return;
    const row = rows[d.rowId];
    const cur = row?.cells?.[d.colId];
    // Keep whatever followed the date (a time, a timezone) exactly as it was.
    const tail = typeof cur === 'string' && cur.length > 10 ? cur.slice(10) : '';
    setCell(d.rowId, d.colId, `${dayIso}${tail}`);
  };

  // Making an event on a day. Shared with the Itinerary tab; see useDayAdd for the
  // page-scoping and encryption notes.
  const { targets: addTargets, day: addDay, setDay: setAddDay, anchor: addAnchor, create: createOn, start: startAdd } = useDayAdd(tables);
  const sources = useMemo(() => [...new Set(events.map((e) => e.tableName))].sort(), [events]);
  const shown = useMemo(
    () => events.filter((e) => (source === null || e.tableName === source) && (!hideDone || !e.done)),
    [events, source, hideDone],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, { e: (typeof events)[number]; edge: Edge }[]>();
    const push = (day: string, e: (typeof events)[number], edge: Edge) => {
      const arr = m.get(day) ?? [];
      arr.push({ e, edge });
      m.set(day, arr);
    };
    for (const e of shown) {
      const span = spans.get(e.rowId);
      if (span && e.day === span.to) continue; // folded into the bar below
      if (span && e.day === span.from) {
        // Cap the walk so a typo'd end date can't build a thousand cells.
        for (let day = span.from, i = 0; day <= span.to && i < 366; day = addDaysIso(day, 1), i++) {
          push(day, e, day === span.from ? 'start' : day === span.to ? 'end' : 'mid');
        }
        continue;
      }
      push(e.day, e, 'only');
    }
    return m;
  }, [shown, spans]);

  const today = todayIso();
  // Open on the month of the first upcoming event, else the current month.
  const initial = useMemo(() => {
    const next = events.find((e) => e.day >= today) ?? events[events.length - 1];
    const iso = next?.day ?? today;
    const [y, m] = iso.split('-').map(Number);
    return { y, m: m - 1 };
  }, [events, today]);
  const [ym, setYm] = useState(initial);
  // Month navigates by month; week and day navigate by their own cursor, so
  // switching between them keeps you roughly where you were looking.
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState<string>(() => {
    const next = events.find((e) => e.day >= todayIso());
    return next?.day ?? todayIso();
  });
  const weekDays = useMemo(() => {
    const from = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDaysIso(from, i));
  }, [cursor]);

  // With an event's drawer open, left/right jump to the previous/next day that
  // has events and up/down walk that day's list; the month grid follows along.
  useRowNavSource(
    () => [...byDay.values()].map((evs) => evs.map((x) => x.e.rowId).filter(Boolean)),
    (rowId) => {
      const ev = events.find((e) => e.rowId === rowId);
      if (!ev) return;
      const [yy, mm] = ev.day.split('-').map(Number);
      setYm((cur) => (cur.y === yy && cur.m === mm - 1 ? cur : { y: yy, m: mm - 1 }));
    },
  );

  // Every dated item on this page as an add-to-calendar event (title + date), for
  // the header "add all" export. Reservation-widget items and table rows alike.
  const calEvents = useMemo<CalEvent[]>(
    () =>
      shown.map((e) => ({
        title: e.title,
        startIso: e.dateIso,
        description: `${e.tableName}${e.fieldName ? ` · ${e.fieldName}` : ''}`,
        uid: e.key.replace(/[^\w-]/g, '-'),
      })),
    [shown],
  );

  const weeks = useMemo(() => monthMatrix(ym.y, ym.m), [ym]);
  // One step means a different thing per view, which is the whole point of having
  // them: a month at a time when you are scanning, a day at a time when you are
  // planning Tuesday.
  const step = (delta: number) => {
    if (mode === 'month') {
      setYm(({ y, m }) => {
        const nm = m + delta;
        return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
      });
      return;
    }
    setCursor((c) => addDaysIso(c, delta * (mode === 'week' ? 7 : 1)));
  };
  const goToday = () => {
    setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
    setCursor(today);
  };

  const inView =
    mode === 'month'
      ? [...byDay.entries()].filter(([iso]) => iso.startsWith(`${ym.y}-${String(ym.m + 1).padStart(2, '0')}`))
      : mode === 'week'
        ? [...byDay.entries()].filter(([iso]) => weekDays.includes(iso))
        : [...byDay.entries()].filter(([iso]) => iso === cursor);
  const viewCount = inView.reduce((n, [, evs]) => n + evs.length, 0);
  const heading =
    mode === 'month'
      ? `${MONTHS[ym.m]} ${ym.y}`
      : mode === 'week'
        ? `${dayHeading(weekDays[0])} to ${dayHeading(weekDays[6])}`
        : dayHeading(cursor);
  const btn = 'rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line';

  // One event chip, shared by the week and day rails so they cannot drift.
  const eventChip = (e: (typeof events)[number], showTime: boolean) => (
    <button
      key={e.key}
      type="button"
      onClick={() => { if (!e.widget) openRow(e.rowId); }}
      title={`${e.title}${e.timeLabel ? ` · ${e.timeLabel}` : ''} · ${e.tableName}`}
      className={[
        'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] leading-tight',
        e.widget
          ? 'cursor-default bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : e.done
            ? 'bg-paper-panel text-ink-faint line-through dark:bg-coal-line dark:text-coal-soft'
            : 'bg-clay/15 text-clay hover:bg-clay/25',
      ].join(' ')}
    >
      {showTime && e.timeLabel && <span className="shrink-0 font-mono tabular-nums">{e.timeLabel}</span>}
      <span className="min-w-0 flex-1 truncate">{e.title}</span>
    </button>
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-3 py-4 sm:px-6">
      {/* A strip, never a takeover. Encryption only hides which EVENTS are on the
          page; the month grid, the dates and Today all come from the device clock
          and work regardless. Replacing the whole tab took a working calendar away
          and made "jump to today" impossible for no reason. */}
      {unreadable && <LockedBodyStrip what="dated items" />}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-clay" />
        <h2 className="text-base font-semibold text-ink dark:text-coal-text">{heading}</h2>
        <span className="rounded-full bg-paper-panel px-2 py-0.5 text-[11px] font-medium text-ink-faint dark:bg-coal-line dark:text-coal-soft">
          {viewCount} {mode === 'month' ? 'this month' : mode === 'week' ? 'this week' : 'today'}
        </span>
        <div className="flex overflow-hidden rounded-md border border-paper-line dark:border-coal-line">
          {(['month', 'week', 'day'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                'px-2 py-0.5 text-[11px] font-medium capitalize',
                mode === m ? 'bg-clay text-white' : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>
        {shown.length !== events.length && (
          <span className="text-[11px] text-ink-faint dark:text-coal-soft">
            {shown.length} of {events.length} shown
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {calEvents.length > 0 && (
            <AddToCalendarButton events={calEvents} calName={`${page?.title || 'Waypoint'} calendar`} label="Add all" align="right" />
          )}
          <button type="button" onClick={() => step(-1)} className="rounded-md p-1 text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line" title="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={goToday} className={btn}>
            Today
          </button>
          <button type="button" onClick={() => step(1)} className="rounded-md p-1 text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line" title="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Second row: which items, and where to jump. A trip page carries several
          tables at once, so "show me only the stays" is the control this was missing. */}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {sources.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setSource(null)}
              className={chip(source === null)}
            >
              All
            </button>
            {sources.map((s) => (
              <button key={s} type="button" onClick={() => setSource(s)} className={chip(source === s)} title={`Show only ${s}`}>
                {s}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-paper-line dark:bg-coal-line" />
          </>
        )}
        <button
          type="button"
          onClick={() => setHideDone((v) => !v)}
          className={chip(hideDone)}
          title="Hide items whose row is ticked done"
        >
          {hideDone ? <EyeOff className="mr-1 inline h-3 w-3" /> : <Eye className="mr-1 inline h-3 w-3" />}
          Hide done
        </button>
        {shown.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => { const [yy, mm] = shown[0].day.split('-').map(Number); setYm({ y: yy, m: mm - 1 }); }}
              className={btn}
              title={`Jump to the first item (${shown[0].day})`}
            >
              First
            </button>
            <button
              type="button"
              onClick={() => { const [yy, mm] = shown[shown.length - 1].day.split('-').map(Number); setYm({ y: yy, m: mm - 1 }); }}
              className={btn}
              title={`Jump to the last item (${shown[shown.length - 1].day})`}
            >
              Last
            </button>
          </>
        )}
        {(source !== null || hideDone) && (
          <button type="button" onClick={() => { setSource(null); setHideDone(false); }} className={btn} title="Clear the filters">
            Reset
          </button>
        )}
      </div>

      {/* Week: seven day columns over one shared hour rail, so "what does Tuesday
          look like" is one glance. All-day items sit above the rail, since they have
          no hour to be placed at and pinning them to midnight would be a lie. */}
      {mode === 'week' && (
        <div className="flex-1 overflow-auto">
          <div className="grid min-w-[44rem] grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-l border-t border-paper-line dark:border-coal-line">
            <div className="border-b border-r border-paper-line bg-paper-panel/50 dark:border-coal-line dark:bg-coal-line/40" />
            {weekDays.map((iso) => (
              <div
                key={iso}
                className={[
                  'group/day flex items-center gap-1 border-b border-r border-paper-line bg-paper-panel/50 px-2 py-1 text-[11px] font-semibold dark:border-coal-line dark:bg-coal-line/40',
                  iso === today ? 'text-clay' : 'text-ink-faint dark:text-coal-soft',
                ].join(' ')}
              >
                {dayHeading(iso)}
                {addTargets.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => startAdd(iso, e.currentTarget)}
                    className="ml-auto rounded p-0.5 opacity-0 hover:bg-clay/15 hover:text-clay focus:opacity-100 group-hover/day:opacity-100"
                    title="Add an item on this day"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}

            {/* all-day row */}
            <div className="border-b border-r border-paper-line px-1 py-1 text-right text-[10px] text-ink-faint dark:border-coal-line dark:text-coal-soft">
              all day
            </div>
            {weekDays.map((iso) => (
              <div key={`ad-${iso}`} className="min-h-[2.5rem] space-y-0.5 border-b border-r border-paper-line p-1 dark:border-coal-line">
                {(byDay.get(iso) ?? []).filter(({ e, edge }) => hourOf(e.dateIso) === null || edge === 'mid' || edge === 'end').map(({ e }) => eventChip(e, false))}
              </div>
            ))}

            {HOURS.map((h) => (
              <Fragment key={h}>
                <div className="border-b border-r border-paper-line px-1 py-1 text-right text-[10px] tabular-nums text-ink-faint dark:border-coal-line dark:text-coal-soft">
                  {hourLabel(h)}
                </div>
                {weekDays.map((iso) => (
                  <div key={`${iso}-${h}`} className="min-h-[2.25rem] space-y-0.5 border-b border-r border-paper-line p-0.5 dark:border-coal-line">
                    {(byDay.get(iso) ?? []).filter(({ e, edge }) => hourOf(e.dateIso) === h && (edge === 'only' || edge === 'start')).map(({ e }) => eventChip(e, true))}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Day: the same rail for one day, with room for the title to breathe. */}
      {mode === 'day' && (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] border-l border-t border-paper-line dark:border-coal-line">
            <div className="border-b border-r border-paper-line px-1 py-1 text-right text-[10px] text-ink-faint dark:border-coal-line dark:text-coal-soft">
              all day
            </div>
            <div className="min-h-[2.5rem] space-y-1 border-b border-r border-paper-line p-1.5 dark:border-coal-line">
              {(byDay.get(cursor) ?? []).filter(({ e, edge }) => hourOf(e.dateIso) === null || edge === 'mid' || edge === 'end').map(({ e }) => eventChip(e, false))}
            </div>
            {HOURS.map((h) => (
              <Fragment key={h}>
                <div className="border-b border-r border-paper-line px-1 py-1 text-right text-[10px] tabular-nums text-ink-faint dark:border-coal-line dark:text-coal-soft">
                  {hourLabel(h)}
                </div>
                <div className="group/day min-h-[2.5rem] space-y-1 border-b border-r border-paper-line p-1.5 dark:border-coal-line">
                  {(byDay.get(cursor) ?? []).filter(({ e, edge }) => hourOf(e.dateIso) === h && (edge === 'only' || edge === 'start')).map(({ e }) => eventChip(e, true))}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {mode === 'month' && (
      <div className="grid flex-1 grid-cols-7 border-l border-t border-paper-line dark:border-coal-line">
        {DOW.map((d) => (
          <div key={d} className="border-b border-r border-paper-line bg-paper-panel/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint dark:border-coal-line dark:bg-coal-line/40 dark:text-coal-soft">
            {d}
          </div>
        ))}
        {weeks.flat().map((iso, i) => {
          const dayEvents = iso ? byDay.get(iso) ?? [] : [];
          const isToday = iso === today;
          return (
            <div
              key={i}
              onDragOver={(ev) => { if (iso && dragging) { ev.preventDefault(); setOverDay(iso); } }}
              onDragLeave={() => setOverDay((d) => (d === iso ? null : d))}
              onDrop={(ev) => { if (iso && dragging) { ev.preventDefault(); dropOn(iso); } }}
              className={[
                'min-h-[7.5rem] border-b border-r border-paper-line p-1.5 align-top dark:border-coal-line',
                iso ? (i % 7 >= 5 ? 'bg-clay-wash/25 dark:bg-clay/5' : '') : 'bg-paper-panel/30 dark:bg-coal-line/20',
                overDay === iso && dragging ? 'ring-2 ring-inset ring-clay' : '',
              ].join(' ')}
            >
              {iso && (
                <>
                  <div className={['group/day mb-1 flex items-center gap-1 px-0.5 text-xs tabular-nums', isToday ? 'font-bold text-clay' : 'text-ink-faint dark:text-coal-soft'].join(' ')}>
                    <span className={isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-clay text-[11px] text-white' : ''}>
                      {Number(iso.slice(8, 10))}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="ml-auto text-[10px] font-normal text-ink-faint dark:text-coal-soft">{dayEvents.length}</span>
                    )}
                    {addTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => startAdd(iso, e.currentTarget)}
                        className={[
                          'shrink-0 rounded p-0.5 text-ink-faint opacity-0 hover:bg-clay/15 hover:text-clay focus:opacity-100 group-hover/day:opacity-100',
                          dayEvents.length > 0 ? '' : 'ml-auto',
                        ].join(' ')}
                        title={addTargets.length === 1 ? `Add to ${addTargets[0].table.name || 'this table'}` : 'Add an item on this day'}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 6).map(({ e, edge }) => {
                      const here = presence?.get(e.rowId);
                      const occupied = here && here.length > 0;
                      const who = occupied ? here[0] : null;
                      // A multi-day stay renders as one bar: square inner
                      // corners so the chips read as a run across the cells.
                      const shape = edge === 'start' ? 'rounded-l rounded-r-none' : edge === 'mid' ? 'rounded-none' : edge === 'end' ? 'rounded-r rounded-l-none' : 'rounded';
                      return (
                        <button
                          key={e.key}
                          type="button"
                          // Only a real table row can be dragged. A reservation chip
                          // comes from a widget in the page body and has no cell to
                          // rewrite, so it stays put rather than pretending to move.
                          draggable={!e.widget && !!e.rowId && !!colIdOf(e.key)}
                          onDragStart={() => { const c = colIdOf(e.key); if (c) setDragging({ rowId: e.rowId, colId: c, from: e.day }); }}
                          onDragEnd={() => { setDragging(null); setOverDay(null); }}
                          onClick={() => { if (!e.widget) openRow(e.rowId); }}
                          title={`${e.title}${e.timeLabel ? ` · ${e.timeLabel}` : ''} · ${e.tableName}${e.widget ? ' (reservation)' : ''}${who ? ` · ${(here ?? []).map((p) => p.userName).join(', ')} here` : ''}`}
                          className={['flex w-full items-center gap-1 truncate px-1.5 py-1 text-left text-[11px] leading-tight', shape, occupied ? 'bg-clay/25 text-clay ring-1 ring-clay/50' : e.widget ? 'cursor-default bg-amber-500/15 text-amber-600 dark:text-amber-400' : e.done ? 'bg-paper-panel text-ink-faint line-through dark:bg-coal-line dark:text-coal-soft' : 'bg-clay/15 text-clay hover:bg-clay/25'].join(' ')}
                        >
                          <span className={['min-w-0 flex-1 truncate', edge === 'mid' || edge === 'end' ? 'opacity-80' : ''].join(' ')}>
                            {e.timeLabel && edge !== 'mid' && edge !== 'end' && <span className="font-mono tabular-nums">{e.timeLabel} </span>}
                            {e.title}
                          </span>
                          {who && (
                            <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full text-[7px] font-semibold text-white" style={{ backgroundColor: avatarColor(who.user) }}>
                              {initials(who.userName)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {dayEvents.length > 6 && <div className="px-1 text-[10px] text-ink-faint dark:text-coal-soft">+{dayEvents.length - 6} more</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      )}

      <DayAddMenu
        day={addDay}
        targets={addTargets}
        anchor={addAnchor}
        onClose={() => setAddDay(null)}
        onPick={(d, t, c, wt) => void createOn(d, t, c, wt)}
      />
    </div>
  );
}
