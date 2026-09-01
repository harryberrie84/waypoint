import type { Column, TableData, TableRow } from '../types';
import { titleColumn, cellText, geoOf, type ViewConfig } from './tableQuery';
import { parseDateTime } from './schedule';

// ---------------------------------------------------------------------------
// ICS export, turn a table's dated rows into a calendar feed.
// ---------------------------------------------------------------------------
// Each row with a start date/datetime becomes a VEVENT. Date columns make
// all-day events; datetime columns make timed events with a reminder. The same
// builder backs both the "Download .ics" button and the server subscribe feed,
// so what you download matches what your phone syncs.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Escape per RFC 5545 TEXT rules, then fold to <=75 octets per line.
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function fold(line: string): string {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function stampUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function addDaysIso(dayIso: string, delta: number): string {
  const [y, m, d] = dayIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Pick the columns that drive the calendar: prefer the view's configured ones,
// fall back to the first date/datetime column on the table.
function resolveColumns(columns: Column[], view?: ViewConfig) {
  const dated = (id?: string) => columns.find((c) => c.id === id && (c.type === 'date' || c.type === 'datetime'));
  const start =
    dated(view?.startTimeColumnId) ??
    dated(view?.dateColumnId) ??
    dated(view?.arrivalColumnId) ??
    columns.find((c) => c.type === 'datetime') ??
    columns.find((c) => c.type === 'date');
  const end =
    dated(view?.endTimeColumnId) ??
    dated(view?.endDateColumnId) ??
    dated(view?.departureColumnId);
  const place = columns.find((c) => c.type === 'place');
  return { start, end, title: titleColumn(columns), place };
}

interface DatePart {
  dayIso: string;
  minutes: number;
  hasTime: boolean;
}

function icsValue(p: DatePart): { prop: string; trigger: string } {
  if (p.hasTime) {
    const hh = pad(Math.floor(p.minutes / 60));
    const mm = pad(p.minutes % 60);
    // Floating local time (no Z): shows at this wall-clock time wherever you are.
    return { prop: `:${p.dayIso.replace(/-/g, '')}T${hh}${mm}00`, trigger: '-PT1H' };
  }
  return { prop: `;VALUE=DATE:${p.dayIso.replace(/-/g, '')}`, trigger: '-P1D' };
}

function calHeader(name: string): string[] {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Waypoint//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${esc(name || 'Waypoint')}`),
  ];
}

// The VEVENT lines for one table's dated rows (no VCALENDAR wrapper), so several
// tables can be folded into a single per-page feed.
function tableEvents(table: TableData, rows: TableRow[], now: string, view?: ViewConfig): string[] {
  const { start, end, title, place } = resolveColumns(table.columns, view);
  const lines: string[] = [];
  if (!start) return lines;
  for (const row of rows) {
    const sp = parseDateTime(row.cells[start.id]);
    if (!sp) continue;
    const sv = icsValue(sp);

    let endLine: string;
    const ep = end ? parseDateTime(row.cells[end.id]) : null;
    if (sp.hasTime) {
      const e = ep ?? { ...sp, minutes: sp.minutes + 60 }; // default 1h
      endLine = `DTEND${icsValue(e).prop}`;
    } else {
      // All-day DTEND is exclusive: a single day ends the next morning.
      const endDay = ep ? addDaysIso(ep.dayIso, 1) : addDaysIso(sp.dayIso, 1);
      endLine = `DTEND;VALUE=DATE:${endDay.replace(/-/g, '')}`;
    }

    const summary = (title ? cellText(row.cells[title.id] ?? null, title) : '') || 'Untitled';
    const g = place ? geoOf(row.cells[place.id] ?? null) : null;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${row.id}@waypoint`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART${sv.prop}`);
    lines.push(endLine);
    lines.push(fold(`SUMMARY:${esc(summary)}`));
    if (g) lines.push(fold(`LOCATION:${esc(g.name)}`));
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(fold(`DESCRIPTION:${esc(summary)}`));
    lines.push(`TRIGGER:${sv.trigger}`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }
  return lines;
}

export function tableToICS(table: TableData, rows: TableRow[], view?: ViewConfig): string {
  const now = stampUtc(new Date());
  return [...calHeader(table.name || 'Waypoint'), ...tableEvents(table, rows, now, view), 'END:VCALENDAR'].join('\r\n');
}

// One calendar for every dated row across a page's tables, so each of you can put
// just this page's dates on your phone. Reuses the same per-row VEVENT builder, so
// what you download matches the per-table feed and the server subscribe feed.
export function pageToICS(calName: string, entries: { table: TableData; rows: TableRow[]; view?: ViewConfig }[]): string {
  const now = stampUtc(new Date());
  const events: string[] = [];
  for (const e of entries) events.push(...tableEvents(e.table, e.rows, now, e.view));
  return [...calHeader(calName), ...events, 'END:VCALENDAR'].join('\r\n');
}

// ---------------------------------------------------------------------------
// Generic "add to calendar" for ANY item that has a title + a date: a reservation
// card, a dated table row opened in the drawer, or a whole calendar's worth of
// them. Powers the shared AddToCalendarButton (a .ics download that every OS reads,
// plus a Google Calendar link). Same VEVENT shape/escaping as the table feed above.
// ---------------------------------------------------------------------------

export interface CalEvent {
  title: string;
  startIso: string; // 'YYYY-MM-DD' (all-day) or 'YYYY-MM-DDTHH:mm[:ss]' (timed)
  endIso?: string; // optional; defaults to +1h (timed) or the same day (all-day)
  location?: string;
  description?: string;
  uid?: string; // stable id if you have one (a row/item id); else derived from title+date
}

// Parse the ISO-ish value a cell or widget stores into the day + minutes we need.
// Tolerant of a bare date, a date+time, or a space instead of 'T'.
function partFromIso(iso: string): DatePart | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return null;
  const dayIso = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] != null) return { dayIso, minutes: Number(m[4]) * 60 + Number(m[5]), hasTime: true };
  return { dayIso, minutes: 0, hasTime: false };
}

// A short deterministic hash, so an event with no id gets a STABLE uid across
// exports (re-adding the same item updates rather than duplicates on the phone).
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** True when this item can go on a calendar: it has a non-empty title AND a
 *  parseable date. The button uses this to enable/disable itself, so it appears
 *  the moment both a text and a date are present and vanishes if either goes. */
export function isValidCalEvent(e: { title?: string; startIso?: string }): boolean {
  return !!(e.title && e.title.trim() && e.startIso && partFromIso(e.startIso));
}

function eventLines(ev: CalEvent, now: string): string[] {
  const sp = partFromIso(ev.startIso);
  if (!sp || !ev.title?.trim()) return [];
  const sv = icsValue(sp);
  let endLine: string;
  const ep = ev.endIso ? partFromIso(ev.endIso) : null;
  if (sp.hasTime) {
    const e = ep && ep.hasTime ? ep : { ...sp, minutes: sp.minutes + 60 }; // default 1h
    endLine = `DTEND${icsValue(e).prop}`;
  } else {
    const endDay = ep ? addDaysIso(ep.dayIso, 1) : addDaysIso(sp.dayIso, 1); // all-day DTEND is exclusive
    endLine = `DTEND;VALUE=DATE:${endDay.replace(/-/g, '')}`;
  }
  const uid = ev.uid || `${sp.dayIso.replace(/-/g, '')}-${hash(ev.title)}`;
  const lines = ['BEGIN:VEVENT', `UID:${uid}@waypoint`, `DTSTAMP:${now}`, `DTSTART${sv.prop}`, endLine, fold(`SUMMARY:${esc(ev.title)}`)];
  if (ev.location) lines.push(fold(`LOCATION:${esc(ev.location)}`));
  if (ev.description) lines.push(fold(`DESCRIPTION:${esc(ev.description)}`));
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${esc(ev.title)}`), `TRIGGER:${sv.trigger}`, 'END:VALARM', 'END:VEVENT');
  return lines;
}

/** A full .ics (VCALENDAR) for one or more arbitrary events. Invalid ones (no
 *  title or unparseable date) are skipped, so a mixed list still exports cleanly. */
export function eventsToICS(calName: string, events: CalEvent[]): string {
  const now = stampUtc(new Date());
  const body: string[] = [];
  for (const ev of events) body.push(...eventLines(ev, now));
  return [...calHeader(calName), ...body, 'END:VCALENDAR'].join('\r\n');
}

/** A Google Calendar "create event" URL for a single event, the browser fallback
 *  alongside the .ics download (handy for anyone who lives in Google Calendar). */
export function googleCalUrl(ev: CalEvent): string {
  const sp = partFromIso(ev.startIso);
  if (!sp || !ev.title?.trim()) return '';
  const stamp = (p: DatePart) => (p.hasTime ? `${p.dayIso.replace(/-/g, '')}T${pad(Math.floor(p.minutes / 60))}${pad(p.minutes % 60)}00` : p.dayIso.replace(/-/g, ''));
  const ep = ev.endIso ? partFromIso(ev.endIso) : null;
  let end: string;
  if (sp.hasTime) end = stamp(ep && ep.hasTime ? ep : { ...sp, minutes: sp.minutes + 60 });
  else end = (ep ? addDaysIso(ep.dayIso, 1) : addDaysIso(sp.dayIso, 1)).replace(/-/g, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${stamp(sp)}/${end}` });
  if (ev.description) params.set('details', ev.description);
  if (ev.location) params.set('location', ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
