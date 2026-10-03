import type { CellValue, Column, TableData, TableRow } from '../types';
import { formulaFor } from './scope';
import type { TablePreset } from './tableQuery';

export type WidgetKind =
  | 'accommodation'
  | 'authority'
  | 'lecture'
  | 'bills'
  | 'deadlines'
  | 'meals'
  | 'groceries'
  | 'family'
  | 'packing'
  | 'routine'
  | 'budget'
  | 'rolltable'
  | 'combat'
  | 'journal'
  | 'itinerary'
  | 'transport'
  | 'schedule'
  | 'campaign';

export interface WidgetSpec {
  kind: WidgetKind;
  label: string;
  noun: string;
  requires: string[];
  title: string;
  check?: string;
  group?: string;
  sub?: string[];
  badges?: string[];
  people?: string;
  when?: string;
  until?: string;
  due?: string;
  amount?: string;
  currency?: string;
  total?: string;
  link?: string;
  stats?: string[];
  roll?: { weight: string; range: string };
  combat?: { init: string; hp: string; max: string; active: string; conditions: string };
  bare?: boolean;
  pastIsDone?: boolean;
}

export const WIDGET_SPECS: WidgetSpec[] = [
  { kind: 'accommodation', label: 'Stays', noun: 'stay', requires: ['Hotel / Airbnb', 'Check-in', 'Check-out'], title: 'Hotel / Airbnb', sub: ['Place', 'Confirmation #'], badges: ['Status'], when: 'Check-in', until: 'Check-out', amount: 'Total', link: 'Booking' },
  { kind: 'authority', label: 'Authorities', noun: 'source', requires: ['Source', 'Citation', 'Read'], title: 'Source', check: 'Read', sub: ['Citation', 'For'], badges: ['Type'], link: 'Link' },
  { kind: 'lecture', label: 'Lecture notes', noun: 'topic', requires: ['Topic', 'Course', 'Follow up'], title: 'Topic', sub: ['Course', 'Notes'], badges: ['Follow up'], when: 'Date' },
  { kind: 'bills', label: 'Bills', noun: 'bill', requires: ['Bill', 'Due', 'Paid'], title: 'Bill', check: 'Paid', sub: ['Account'], badges: ['Category'], due: 'Due', amount: 'Amount', currency: 'Currency' },
  { kind: 'deadlines', label: 'Countdown', noun: 'date', requires: ['What', 'Date', 'Days left'], title: 'What', sub: ['Notes'], badges: ['Type'], due: 'Date' },
  { kind: 'meals', label: 'Meal plan', noun: 'meal', requires: ['Dish', 'Day', 'Cooked'], title: 'Dish', check: 'Cooked', group: 'Day', sub: ['Notes'] },
  { kind: 'groceries', label: 'Groceries', noun: 'item', requires: ['Item', 'Aisle', 'Got it'], title: 'Item', check: 'Got it', group: 'Aisle', sub: ['Qty'] },
  { kind: 'family', label: 'Family', noun: 'item', requires: ['Item', 'Who', 'Category', 'Notes'], title: 'Item', group: 'Category', sub: ['Notes'], people: 'Who', link: 'Link' },
  { kind: 'packing', label: 'Packing', noun: 'item', requires: ['Item', 'Packed', 'Priority'], title: 'Item', check: 'Packed', group: 'Category', badges: ['Priority'], people: 'Who' },
  { kind: 'routine', label: 'Routines', noun: 'routine', requires: ['Routine', 'Cadence', 'Done today'], title: 'Routine', check: 'Done today', badges: ['Cadence'], stats: ['Streak', 'Days since'] },
  { kind: 'budget', label: 'Budget', noun: 'expense', requires: ['Item', 'Amount', 'Paid by', 'Split among'], title: 'Item', badges: ['Category'], people: 'Paid by', when: 'Date', amount: 'Amount', currency: 'Currency', total: 'In ' },
  { kind: 'rolltable', label: 'Roll table', noun: 'result', requires: ['Range', 'Weight', 'Result'], title: 'Result', roll: { weight: 'Weight', range: 'Range' } },
  { kind: 'combat', label: 'Initiative', noun: 'combatant', requires: ['Combatant', 'Init', 'HP', 'Max', 'Active'], title: 'Combatant', combat: { init: 'Init', hp: 'HP', max: 'Max', active: 'Active', conditions: 'Conditions' } },
  { kind: 'journal', label: 'Journal', noun: 'entry', requires: ['Entry', 'Date', 'Mood'], title: 'Entry', bare: true },
  { kind: 'itinerary', label: 'Itinerary', noun: 'stop', requires: ['Stop', 'Arrive', 'Depart'], title: 'Stop', bare: true },
  { kind: 'transport', label: 'Transport', noun: 'leg', requires: ['Leg', 'Mode', 'Carrier'], title: 'Leg', sub: ['From', 'To', 'Carrier', 'Number', 'Seat', 'Confirmation'], badges: ['Mode'], due: 'Depart', pastIsDone: true },
  { kind: 'schedule', label: 'Schedule', noun: 'event', requires: ['Event', 'Start', 'End'], title: 'Event', bare: true },
  { kind: 'campaign', label: 'Quests', noun: 'quest', requires: ['Quest', 'Giver', 'Reward'], title: 'Quest', bare: true },
];

export const PRESET_TABLE_NAMES: Partial<Record<TablePreset, string>> = {
  accommodation: 'Stays',
  journal: 'Journal',
  itinerary: 'Itinerary',
  transport: 'Transport',
  schedule: 'Schedule',
  budget: 'Budget',
  packing: 'Packing',
  authority: 'Authorities',
  lecture: 'Lecture notes',
  bills: 'Bills',
  deadlines: 'Countdown',
  meals: 'Meal plan',
  groceries: 'Groceries',
  campaign: 'Quests',
  family: 'Family',
  rolltable: 'Roll table',
  combat: 'Initiative',
  routine: 'Routines',
};

const norm = (s: string) => s.trim().toLowerCase();

export function columnNamed(columns: readonly Column[], name: string | undefined): Column | undefined {
  if (!name) return undefined;
  const n = norm(name);
  return columns.find((c) => norm(c.name) === n) ?? (name.endsWith(' ') ? columns.find((c) => norm(c.name).startsWith(n) && c.type === 'formula') : undefined);
}

export function widgetFor(table: Pick<TableData, 'columns' | 'formKey'> | undefined): WidgetSpec | null {
  if (!table || table.formKey) return null;
  const names = new Set(table.columns.map((c) => norm(c.name)));
  for (const spec of WIDGET_SPECS) {
    if (spec.requires.every((r) => names.has(norm(r)))) return spec;
  }
  return null;
}

export function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function todayNumber(now: Date = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
}

export function daysFrom(value: CellValue | undefined, now: Date = new Date()): number | null {
  if (typeof value !== 'string') return null;
  const d = dayNumber(value);
  return d == null ? null : d - todayNumber(now);
}

export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function dueTone(days: number | null, done: boolean): 'done' | 'late' | 'soon' | 'later' | 'none' {
  if (done) return 'done';
  if (days == null) return 'none';
  if (days < 0) return 'late';
  if (days <= 7) return 'soon';
  return 'later';
}

export function nightsBetween(from: CellValue | undefined, to: CellValue | undefined): number {
  if (typeof from !== 'string' || typeof to !== 'string') return 0;
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a != null && b != null && b > a ? b - a : 0;
}

export interface WidgetGroup {
  id: string;
  label: string;
  color?: string;
  rows: TableRow[];
}

export function groupRows(rows: readonly TableRow[], column: Column | undefined): WidgetGroup[] {
  if (!column || (column.type !== 'select' && column.type !== 'multiselect')) return [{ id: '', label: '', rows: [...rows] }];
  const groups = new Map<string, WidgetGroup>();
  for (const o of column.options ?? []) groups.set(o.id, { id: o.id, label: o.label, color: o.color, rows: [] });
  const none: WidgetGroup = { id: '', label: 'Other', rows: [] };
  for (const r of rows) {
    const v = r.cells[column.id];
    const key = Array.isArray(v) ? (v[0] as string | undefined) : typeof v === 'string' ? v : undefined;
    const g = key ? groups.get(key) : undefined;
    (g ?? none).rows.push(r);
  }
  const out = [...groups.values()].filter((g) => g.rows.length > 0);
  if (none.rows.length) out.push(none);
  return out;
}

export function isBlankRow(row: TableRow, columns: readonly Column[]): boolean {
  return columns.every((c) => {
    const v = row.cells[c.id];
    return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
  });
}

export function sortForWidget(rows: readonly TableRow[], spec: WidgetSpec, columns: readonly Column[]): TableRow[] {
  const check = columnNamed(columns, spec.check);
  const due = columnNamed(columns, spec.due ?? spec.when);
  const init = spec.combat ? columnNamed(columns, spec.combat.init) : undefined;
  const out = [...rows];
  if (init) {
    out.sort((a, b) => (Number(b.cells[init.id]) || 0) - (Number(a.cells[init.id]) || 0));
    return out;
  }
  if (due && (spec.due || spec.kind === 'accommodation')) {
    out.sort((a, b) => {
      const da = typeof a.cells[due.id] === 'string' ? dayNumber(a.cells[due.id] as string) : null;
      const db = typeof b.cells[due.id] === 'string' ? dayNumber(b.cells[due.id] as string) : null;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }
  if (check && (spec.due || spec.kind === 'groceries' || spec.kind === 'packing')) {
    out.sort((a, b) => Number(a.cells[check.id] === true) - Number(b.cells[check.id] === true));
  }
  return out;
}

export function weightedPick(rows: readonly TableRow[], weight: Column | undefined, random: () => number = Math.random): TableRow | null {
  if (!rows.length) return null;
  const weights = rows.map((r) => {
    const w = weight ? Number(r.cells[weight.id]) : 1;
    return Number.isFinite(w) && w > 0 ? w : weight && r.cells[weight.id] !== undefined && r.cells[weight.id] !== '' ? 0 : 1;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return rows[Math.floor(random() * rows.length)] ?? null;
  let x = random() * sum;
  for (let i = 0; i < rows.length; i++) {
    x -= weights[i];
    if (x < 0) return rows[i];
  }
  return rows[rows.length - 1];
}

export function nextActive(order: readonly TableRow[], active: Column | undefined): { off: string[]; on: string | null } {
  if (!active || order.length === 0) return { off: [], on: null };
  const idx = order.findIndex((r) => r.cells[active.id] === true);
  const off = order.filter((r) => r.cells[active.id] === true).map((r) => r.id);
  const on = order[(idx + 1) % order.length]?.id ?? null;
  return { off: off.filter((id) => id !== on), on };
}

export function formulaReady(col: Column, row: TableRow, columns: readonly Column[], seen: Set<string> = new Set()): boolean {
  if (col.type !== 'formula') {
    const v = row.cells[col.id];
    return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
  }
  if (seen.has(col.id)) return true;
  seen.add(col.id);
  const refs = [...formulaFor(col, row.cells).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  return refs.every((name) => {
    const ref = columnNamed(columns, name);
    return !ref || formulaReady(ref, row, columns, seen);
  });
}
