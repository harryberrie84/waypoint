// Cross-table agenda: scan every table row for anything dated (date / datetime /
// reminder columns, and checklist items with a due date) and return a flat,
// sorted list. Powers the Home surface and the Agenda view. Pure and roster-free
// so it stays testable; the components resolve names and navigation.

import type { TableData, TableRow, ChecklistItem } from '../types';
import { titleColumn, cellText, isRowDone } from './tableQuery';
import { parseInstant } from './reminders';

export type AgendaStatus = 'overdue' | 'today' | 'upcoming';

export interface AgendaItem {
  id: string; // stable: `${rowId}:${columnId}` (+ checklist item id)
  ms: number; // when, epoch ms
  raw: string; // the raw date string
  hasTime: boolean;
  title: string; // the row title, or the checklist item text
  field: string; // the column name, or 'Checklist'
  status: AgendaStatus;
  tableId: string;
  rowId: string;
  workspace: string;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayStatus(ms: number, now: number): AgendaStatus {
  const item = startOfDay(ms);
  const today = startOfDay(now);
  if (item < today) return 'overdue';
  if (item === today) return 'today';
  return 'upcoming';
}

/** Every dated thing across the given tables, soonest first. `horizonDays` caps
 *  how far ahead upcoming items are kept (overdue + today are always included). */
export function collectAgenda(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  now: number,
  horizonDays = 60,
): AgendaItem[] {
  const out: AgendaItem[] = [];
  const cutoff = now + horizonDays * 86400000;

  for (const row of Object.values(rows)) {
    const table = tables[row.table];
    if (!table) continue;
    if (isRowDone(table, row)) continue; // finished work drops off the agenda
    const tCol = titleColumn(table.columns);
    const rowTitle = (tCol ? cellText(row.cells[tCol.id] ?? null, tCol) : '') || 'Untitled';

    for (const col of table.columns) {
      // A reminder is a task and always counts; a plain date/datetime is a calendar
      // event and only counts when the column is flagged as a deadline, so ordinary
      // dated rows never show up as "overdue".
      if (col.type === 'reminder' || ((col.type === 'date' || col.type === 'datetime') && col.agendaDue)) {
        const v = row.cells[col.id];
        const ms = parseInstant(v);
        if (ms === null || ms > cutoff) continue;
        out.push({
          id: `${row.id}:${col.id}`,
          ms,
          raw: String(v),
          hasTime: /[T ]\d\d:/.test(String(v)),
          title: rowTitle,
          field: col.name,
          status: dayStatus(ms, now),
          tableId: table.id,
          rowId: row.id,
          workspace: row.workspace ?? table.workspace ?? '',
        });
      } else if (col.type === 'checklist') {
        const items: ChecklistItem[] = Array.isArray(row.cells[col.id])
          ? (row.cells[col.id] as unknown as ChecklistItem[])
          : [];
        for (const it of items) {
          if (!it || it.checked || !it.due) continue;
          const ms = parseInstant(it.due);
          if (ms === null || ms > cutoff) continue;
          out.push({
            id: `${row.id}:${col.id}:${it.id}`,
            ms,
            raw: it.due,
            hasTime: false,
            title: it.text || rowTitle,
            field: 'Checklist',
            status: dayStatus(ms, now),
            tableId: table.id,
            rowId: row.id,
            workspace: row.workspace ?? table.workspace ?? '',
          });
        }
      }
    }
  }

  return out.sort((a, b) => a.ms - b.ms);
}

export interface OnThisDayItem {
  id: string;
  title: string;
  field: string;
  yearsAgo: number;
  tableId: string;
  rowId: string;
  workspace: string;
}

/** Dated rows whose month and day match today, from an earlier year, so past
 *  trips and notes resurface ("a year ago today"). The same scan as the agenda,
 *  a backward window. */
export function onThisDay(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  now: number,
): OnThisDayItem[] {
  const today = new Date(now);
  const m = today.getMonth();
  const d = today.getDate();
  const year = today.getFullYear();
  const out: OnThisDayItem[] = [];

  for (const row of Object.values(rows)) {
    const table = tables[row.table];
    if (!table) continue;
    const tCol = titleColumn(table.columns);
    const rowTitle = (tCol ? cellText(row.cells[tCol.id] ?? null, tCol) : '') || 'Untitled';

    for (const col of table.columns) {
      if (col.type !== 'date' && col.type !== 'datetime' && col.type !== 'reminder') continue;
      const ms = parseInstant(row.cells[col.id]);
      if (ms == null) continue;
      const dt = new Date(ms);
      if (dt.getMonth() === m && dt.getDate() === d && dt.getFullYear() < year) {
        out.push({
          id: `${row.id}:${col.id}`,
          title: rowTitle,
          field: col.name,
          yearsAgo: year - dt.getFullYear(),
          tableId: table.id,
          rowId: row.id,
          workspace: row.workspace ?? '',
        });
      }
    }
  }
  return out.sort((a, b) => a.yearsAgo - b.yearsAgo);
}

/** Group agenda items by calendar day (ms of start-of-day -> items). */
export function groupByDay(items: AgendaItem[]): { day: number; items: AgendaItem[] }[] {
  const map = new Map<number, AgendaItem[]>();
  for (const it of items) {
    const day = startOfDay(it.ms);
    const list = map.get(day) ?? [];
    list.push(it);
    map.set(day, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([day, list]) => ({ day, items: list }));
}
