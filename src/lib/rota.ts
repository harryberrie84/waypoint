// Rota: recurring jobs that rotate between people, fairly.
//
// The thing that makes this more than a checklist is WHOSE turn it is. A plain
// round-robin drifts the moment someone does a job out of turn or covers for
// somebody, so the turn is derived from the log rather than stored: the next
// person is whoever has done this job least, and the rotation order breaks ties.
// Do someone else's turn and the rota absorbs it instead of arguing.
//
// Pure. Dates are ISO 'YYYY-MM-DD' local days, and "today" is always a parameter.

export interface Chore {
  id: string;
  name: string;
  /** How often it comes round. 7 = weekly. */
  everyDays: number;
  /** Member ids in rotation order. Empty means nobody is assigned yet. */
  people: string[];
  /** Optional, purely cosmetic on the card. */
  note?: string;
}

export interface RotaEntry {
  choreId: string;
  /** ISO day it was done. */
  on: string;
  /** Member id who did it. */
  by: string;
}

export interface RotaData {
  chores: Chore[];
  log: RotaEntry[];
}

export const emptyRota = (): RotaData => ({ chores: [], log: [] });

/** 'YYYY-MM-DD' for a local date, the same shape the date columns use. */
export function isoDay(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days between two ISO days, b - a. Parsed as local noon so a daylight
 *  saving shift cannot turn a whole day into 23 hours and round the wrong way. */
export function daysBetween(a: string, b: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, 12).getTime();
  };
  return Math.round((parse(b) - parse(a)) / 86400000);
}

/** The most recent log entry for a chore, or null. */
export function lastDone(chore: Chore, log: RotaEntry[]): RotaEntry | null {
  let best: RotaEntry | null = null;
  for (const e of log) {
    if (e.choreId !== chore.id) continue;
    if (!best || e.on > best.on) best = e;
  }
  return best;
}

/** The ISO day a chore is next due. A chore never done is due today. */
export function nextDue(chore: Chore, log: RotaEntry[], today: string): string {
  const last = lastDone(chore, log);
  if (!last) return today;
  const [y, m, d] = last.on.split('-').map(Number);
  const at = new Date(y, (m ?? 1) - 1, d ?? 1, 12);
  at.setDate(at.getDate() + Math.max(1, Math.round(chore.everyDays)));
  return isoDay(at);
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

export function dueState(chore: Chore, log: RotaEntry[], today: string): DueState {
  const due = nextDue(chore, log, today);
  const gap = daysBetween(today, due);
  if (gap < 0) return 'overdue';
  if (gap === 0) return 'today';
  // "Soon" is only worth flagging on a chore that is NOT close to daily. The
  // bins being due tomorrow is just Tuesday; the bathroom being due in two days
  // is news. Without this every daily chore sits permanently amber.
  return gap <= 2 && chore.everyDays > 2 ? 'soon' : 'later';
}

/** How many times each person has done this chore. The fairness ledger. */
export function shareOf(chore: Chore, log: RotaEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of chore.people) out[p] = 0;
  for (const e of log) {
    if (e.choreId !== chore.id) continue;
    out[e.by] = (out[e.by] ?? 0) + 1;
  }
  return out;
}

/**
 * Whose turn it is: the assigned person who has done this chore fewest times.
 * Ties break by rotation order, starting after whoever did it last, so a fresh
 * rota still goes round in the order you listed rather than always landing on
 * the first name. Returns null when nobody is assigned.
 */
export function whoseTurn(chore: Chore, log: RotaEntry[]): string | null {
  if (!chore.people.length) return null;
  const share = shareOf(chore, log);
  const last = lastDone(chore, log);
  const from = last ? (chore.people.indexOf(last.by) + 1) % chore.people.length : 0;
  // Rotate the candidate list so the tie-break starts after the last person.
  const order = [...chore.people.slice(from), ...chore.people.slice(0, from)];
  let best = order[0];
  for (const p of order) if ((share[p] ?? 0) < (share[best] ?? 0)) best = p;
  return best;
}

/** Chores in the order they should be worked through: most overdue first, then
 *  by due date, then by name so the list does not jitter between renders. */
export function rotaOrder(data: RotaData, today: string): Chore[] {
  return [...(data.chores ?? [])].sort((a, b) => {
    const da = daysBetween(today, nextDue(a, data.log ?? [], today));
    const db = daysBetween(today, nextDue(b, data.log ?? [], today));
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}

/** Record a completion. Returns fresh data; the log is capped so a household
 *  running this for years cannot grow the page field without bound. */
export function markDone(data: RotaData, choreId: string, by: string, on: string, cap = 2000): RotaData {
  const log = [...(data.log ?? []), { choreId, on, by }];
  return { ...data, log: log.length > cap ? log.slice(log.length - cap) : log };
}

/** Undo the most recent completion of a chore, for the misclick. */
export function undoLast(data: RotaData, choreId: string): RotaData {
  const log = [...(data.log ?? [])];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].choreId === choreId) {
      log.splice(i, 1);
      return { ...data, log };
    }
  }
  return data;
}
