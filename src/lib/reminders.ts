// ---------------------------------------------------------------------------
// Reminders, pure due-date logic for `reminder` columns.
// ---------------------------------------------------------------------------
// A reminder column holds a datetime; its `reminderLead` says how far ahead to
// surface it. "Due now" means the lead window has opened but the moment hasn't
// passed yet. The caller passes `now`, so this is trivially testable and the
// poller (NotificationsBell) just calls it on a timer.

import type { TableData, TableRow, ReminderLead } from '../types';
import { titleColumn, cellText } from './tableQuery';

const LEAD_MS: Record<ReminderLead, number> = {
  at: 0,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export interface DueReminder {
  key: string; // `${rowId}:${columnId}`, stable across polls for dedupe
  tableId: string;
  rowId: string;
  columnId: string;
  fieldName: string; // the reminder column's name
  title: string; // the row's title-column text
  target: number; // ms, the reminder datetime
  fireAt: number; // ms, target minus the column's lead
}

/** Parse a datetime-local (`YYYY-MM-DDTHH:mm`) or date (`YYYY-MM-DD`) string as
 *  local time. Returns epoch ms, or null if it doesn't look like a date. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Format epoch ms back into a `YYYY-MM-DDTHH:mm` local datetime-local string,
 *  the inverse of parseInstant, for writing a snoozed reminder back into a cell. */
export function formatInstant(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whether a date/datetime cell is overdue or due today, for at-a-glance colour
 *  in the grid. `null` for blanks, future dates, and unparseable values. A
 *  date-only value that lands on today reads as 'today', not 'overdue'. */
export function dateStatus(value: unknown, now: number): 'overdue' | 'today' | null {
  const t = parseInstant(value);
  if (t === null) return null;
  const d = new Date(t);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return 'today';
  return t < now ? 'overdue' : null;
}

/** Reminders whose lead window has opened (fireAt ≤ now) and whose moment is
 *  still ahead (now < target), across every table. Sorted soonest-first. */
export function dueReminders(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  now: number,
): DueReminder[] {
  const out: DueReminder[] = [];
  for (const row of Object.values(rows)) {
    const table = tables[row.table];
    if (!table) continue;
    const reminderCols = table.columns.filter((c) => c.type === 'reminder');
    if (!reminderCols.length) continue;

    const tCol = titleColumn(table.columns);
    const title = (tCol ? cellText(row.cells[tCol.id] ?? null, tCol) : '') || 'Untitled';

    for (const col of reminderCols) {
      const target = parseInstant(row.cells[col.id]);
      if (target === null) continue;
      const fireAt = target - LEAD_MS[col.reminderLead ?? 'at'];
      if (fireAt <= now && now < target) {
        out.push({
          key: `${row.id}:${col.id}`,
          tableId: table.id,
          rowId: row.id,
          columnId: col.id,
          fieldName: col.name,
          title,
          target,
          fireAt,
        });
      }
    }
  }
  out.sort((a, b) => a.target - b.target);
  return out;
}

/** The server reminder cron's per-row decision, factored out so it's testable
 *  without PocketBase. Due when the lead window has opened (fireAt ≤ now), the
 *  moment hasn't passed (now < target), and we haven't already sent for this
 *  exact target value (the `${columnId}__notified` sentinel). Mirrors the window
 *  in dueReminders so the client poller and the cron agree on "due". */
export function reminderDue(target: number | null, lead: ReminderLead | undefined, now: number, alreadyNotified: boolean): boolean {
  if (target === null || alreadyNotified) return false;
  const fireAt = target - LEAD_MS[lead ?? 'at'];
  return fireAt <= now && now < target;
}
