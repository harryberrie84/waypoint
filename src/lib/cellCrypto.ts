import type { Column, CellValue } from '../types';

// ---------------------------------------------------------------------------
// Hybrid cell encryption, keep reminders working under E2E.
// ---------------------------------------------------------------------------
// Encrypting a whole row would blind the server reminder cron (it reads the
// datetime and the assignee to decide when to fire and whom to email). So we
// split a row's cells: the OPERATIONAL fields stay plaintext, everything else is
// encrypted into one blob. The server learns "a reminder fires at 6pm for these
// people", never what it's about.
//
// Operational = reminder columns (the datetime), person columns (recipient ids),
// and the `<col>__notified` sentinels the cron writes. Everything else is secret.
//
// Extra: if a row actually has a reminder set, the first column (the row's title,
// which is what the cron puts in the email) is also kept plaintext, so the
// reminder says what it's about. Rows without a reminder keep their title
// encrypted, so the server only ever sees titles of rows you've set a reminder on.

export const ENC_KEY = '__enc';

export function splitCells(
  cells: Record<string, CellValue>,
  columns: Column[],
): { operational: Record<string, CellValue>; secret: Record<string, CellValue> } {
  const reminderIds = columns.filter((c) => c.type === 'reminder').map((c) => c.id);
  const opIds = new Set<string>(reminderIds);
  for (const c of columns) if (c.type === 'person') opIds.add(c.id);

  const hasReminder = reminderIds.some((id) => cells[id] != null && cells[id] !== '');
  if (hasReminder && columns.length) opIds.add(columns[0].id); // title column the cron emails

  const operational: Record<string, CellValue> = {};
  const secret: Record<string, CellValue> = {};
  for (const [k, v] of Object.entries(cells)) {
    if (k === ENC_KEY) continue; // never re-wrap the blob itself
    if (opIds.has(k) || k.endsWith('__notified')) operational[k] = v;
    else secret[k] = v;
  }
  return { operational, secret };
}
