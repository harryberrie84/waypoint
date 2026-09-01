// Portable JSON for a Kanban board: the backing table's columns (every custom
// property), each card (a row) with its cell values, and each card's page body.
// The format is deliberately human/AI-authorable, so a template can be filled in
// by hand: cells are keyed by column NAME (not internal id), select values are
// the option LABEL (not an option id), assignees are member NAMES (not user
// ids), and a card body is markdown (not TipTap JSON). The import side maps
// those friendly values back onto fresh ids; the export side does the reverse.
//
// Non-determinism (id minting, colour assignment) is injected, so the whole
// module is pure and unit-tested. Computed/reference columns (formula, rollup,
// lookup, relation, button, progress) round-trip their definition but never
// their values, they recompute, and cross-table relations can't reconnect from
// a standalone file.

import type { CellValue, Column, ColumnType, GeoValue, ChecklistItem, SelectOption, TableData, TableRow, NumberFormat, ReminderLead } from '../types';
import { markdownToTiptap } from './notionImport';

type Roster = readonly { id: string; name: string }[];

// Column types whose stored value is computed or references other records, so
// there's no portable cell value to carry in a standalone board.
const COMPUTED_TYPES = new Set<ColumnType>(['formula', 'rollup', 'lookup', 'relation', 'button', 'progress']);

const KNOWN_TYPES = new Set<ColumnType>([
  'text', 'number', 'select', 'multiselect', 'date', 'datetime', 'checkbox', 'url', 'place',
  'attachment', 'reminder', 'relation', 'rollup', 'lookup', 'progress', 'button', 'person', 'formula', 'checklist',
]);

// --- Bundle shape -----------------------------------------------------------

export interface KanbanBundleOption {
  label: string;
  color?: string; // a TAG_COLORS hex; assigned on import when absent
  done?: boolean; // a stage that means "complete" (its rows drop off Home)
}

export interface KanbanBundleColumn {
  name: string;
  type: ColumnType;
  options?: KanbanBundleOption[]; // select / multiselect
  formula?: string; // formula
  numberFormat?: NumberFormat; // number / formula / rollup
  reminderLead?: ReminderLead; // reminder
  peopleMulti?: boolean; // person
  isStage?: boolean; // the column the board groups by (its select buckets are the lanes)
}

export interface KanbanBundleCard {
  // The card's stable id, stamped on export. On re-import in "update" mode it
  // matches this card back to its row so an edit lands in place instead of
  // adding a duplicate. Omit it (or hand-author without one) and the card is
  // matched by an exact Title, else added as new.
  id?: string;
  // Keyed by column name (case-insensitive on import). Values are friendly:
  // a select label, an array of labels for multiselect, member names for a
  // person column, an ISO date string, a number/boolean, or a place object.
  cells: Record<string, unknown>;
  body?: string; // markdown, becomes the card's page (row body)
}

export interface KanbanBundle {
  waypointKanban: 1;
  title: string;
  columns: KanbanBundleColumn[];
  cards: KanbanBundleCard[];
  instructions?: string[]; // guidance for a human/AI filling the file; ignored on import
}

// The store consumes this: real Column[] with fresh ids, the group column, and
// per-card cells already keyed by column id plus a ready TipTap body.
export interface KanbanImportPlan {
  name: string;
  columns: Column[];
  groupColumnId?: string;
  cards: { cells: Record<string, CellValue>; body?: object }[];
}

export interface KanbanImportDeps {
  uid: (prefix?: string) => string;
  pickColor: (i: number) => string;
  roster?: Roster;
}

// --- TipTap doc <-> markdown ------------------------------------------------
// Pairs with markdownToTiptap (import). Covers the block set that converter
// produces; a widget/unknown block degrades to its inline text.

interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function inlineToMd(nodes: DocNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '\n';
      if (n.type === 'pageLink' || n.type === 'mention') return String(n.attrs?.label ?? n.attrs?.name ?? '');
      if (n.type !== 'text') return n.text ?? '';
      let t = n.text ?? '';
      const marks = n.marks ?? [];
      const has = (k: string) => marks.some((m) => m.type === k);
      if (has('code')) t = '`' + t + '`';
      if (has('bold')) t = '**' + t + '**';
      if (has('italic')) t = '*' + t + '*';
      const link = marks.find((m) => m.type === 'link');
      if (link && typeof link.attrs?.href === 'string') t = `[${t}](${link.attrs.href})`;
      return t;
    })
    .join('');
}

function listItemToMd(li: DocNode, marker: string, depth: number): string[] {
  const pad = '  '.repeat(depth);
  const [first, ...rest] = li.content ?? [];
  const out = [`${pad}${marker} ${first ? inlineToMd(first.content) : ''}`];
  for (const child of rest) out.push(...blockToMd(child, depth + 1));
  return out;
}

function blockToMd(node: DocNode, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  switch (node.type) {
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return [pad + '#'.repeat(lvl) + ' ' + inlineToMd(node.content)];
    }
    case 'blockquote':
      return (node.content ?? []).flatMap((c) => blockToMd(c, depth)).map((l) => '> ' + l);
    case 'codeBlock':
      return ['```', ...(node.content ?? []).map((c) => c.text ?? '').join('').split('\n'), '```'];
    case 'horizontalRule':
      return ['---'];
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      return (node.content ?? []).flatMap((li, i) => listItemToMd(li, ordered ? `${i + 1}.` : '-', depth));
    }
    case 'taskList':
      return (node.content ?? []).flatMap((li) => listItemToMd(li, li.attrs?.checked ? '- [x]' : '- [ ]', depth));
    case 'paragraph':
      return [pad + inlineToMd(node.content)];
    default: {
      // widget / unknown block: keep any inline text, else drop the line
      const txt = inlineToMd(node.content);
      return txt ? [pad + txt] : [];
    }
  }
}

/** Serialize a TipTap doc to markdown that markdownToTiptap can re-parse. */
export function docToMarkdown(doc: unknown): string {
  const root = doc as DocNode;
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return '';
  return root.content
    .map((b) => blockToMd(b).join('\n'))
    .filter((s) => s.trim() !== '')
    .join('\n\n')
    .trim();
}

// --- Export: board -> bundle ------------------------------------------------

function optionLabel(col: Column, id: unknown): string {
  const o = (col.options ?? []).find((opt) => opt.id === id);
  return o ? o.label : typeof id === 'string' ? id : '';
}

function cellToFriendly(col: Column, value: CellValue, roster: Roster): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  switch (col.type) {
    case 'select':
      return optionLabel(col, value) || undefined;
    case 'multiselect': {
      if (!Array.isArray(value)) return undefined;
      const labels = value.map((v) => optionLabel(col, v)).filter(Boolean);
      return labels.length ? labels : undefined;
    }
    case 'person': {
      const ids = Array.isArray(value) ? value : [value];
      const names = ids.map((id) => roster.find((m) => m.id === id)?.name).filter((n): n is string => !!n);
      return names.length ? names : undefined;
    }
    case 'checklist': {
      if (!Array.isArray(value)) return undefined;
      const items = (value as unknown as ChecklistItem[])
        .filter((i) => i && typeof i === 'object' && typeof i.text === 'string')
        .map((i) => {
          const who = i.who ? roster.find((m) => m.id === i.who)?.name : undefined;
          return { text: i.text, checked: !!i.checked, ...(i.due ? { due: i.due } : {}), ...(who ? { who } : {}) };
        });
      return items.length ? items : undefined;
    }
    case 'checkbox':
      return !!value;
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'place':
      return value; // GeoValue passthrough (name/lat/lon are portable)
    case 'attachment':
      return value; // base64 object; large but self-contained
    default:
      // text, url, date, datetime, reminder: plain string
      return typeof value === 'string' ? value : undefined;
  }
}

function columnToBundle(col: Column, isStage: boolean): KanbanBundleColumn {
  const out: KanbanBundleColumn = { name: col.name, type: col.type };
  if ((col.type === 'select' || col.type === 'multiselect') && col.options?.length) {
    out.options = col.options.map((o) => ({ label: o.label, color: o.color, ...(o.done ? { done: true } : {}) }));
  }
  if (col.type === 'formula' && col.formula) out.formula = col.formula;
  if (col.numberFormat && col.numberFormat !== 'plain') out.numberFormat = col.numberFormat;
  if (col.type === 'reminder' && col.reminderLead) out.reminderLead = col.reminderLead;
  if (col.type === 'person' && col.peopleMulti) out.peopleMulti = true;
  if (isStage) out.isStage = true;
  return out;
}

/** Snapshot a live board (its backing table + rows) as a portable bundle. */
export function boardToBundle(
  table: TableData,
  rows: readonly TableRow[],
  groupColumnId: string | undefined,
  roster: Roster = [],
): KanbanBundle {
  const columns = table.columns.map((c) => columnToBundle(c, c.id === groupColumnId));
  const cards: KanbanBundleCard[] = rows.map((r) => {
    const cells: Record<string, unknown> = {};
    for (const col of table.columns) {
      if (COMPUTED_TYPES.has(col.type)) continue;
      const friendly = cellToFriendly(col, r.cells[col.id] ?? null, roster);
      if (friendly !== undefined) cells[col.name] = friendly;
    }
    const body = docToMarkdown(r.content ?? null);
    return body ? { id: r.id, cells, body } : { id: r.id, cells };
  });
  return { waypointKanban: 1, title: table.name || 'Board', columns, cards };
}

// --- Parse + validate -------------------------------------------------------

/** Parse and validate a pasted/loaded bundle. Throws a readable error on bad input. */
export function parseKanbanBundle(text: string): KanbanBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  const obj = raw as Partial<KanbanBundle>;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.columns)) {
    throw new Error('Not a Kanban board file (expected a "columns" array).');
  }
  const columns: KanbanBundleColumn[] = obj.columns.map((c, i) => {
    const col = c as Partial<KanbanBundleColumn>;
    if (!col || typeof col.name !== 'string' || !col.name.trim()) throw new Error(`Column ${i + 1} is missing a name.`);
    const type = (typeof col.type === 'string' && KNOWN_TYPES.has(col.type as ColumnType) ? col.type : 'text') as ColumnType;
    return {
      name: col.name,
      type,
      options: Array.isArray(col.options)
        ? col.options
            .map((o) => o as Partial<KanbanBundleOption>)
            .filter((o) => o && typeof o.label === 'string' && o.label.trim() !== '')
            .map((o) => ({ label: o.label as string, color: typeof o.color === 'string' ? o.color : undefined, done: !!o.done }))
        : undefined,
      formula: typeof col.formula === 'string' ? col.formula : undefined,
      numberFormat: col.numberFormat,
      reminderLead: col.reminderLead,
      peopleMulti: !!col.peopleMulti,
      isStage: !!col.isStage,
    };
  });
  const cards: KanbanBundleCard[] = Array.isArray(obj.cards)
    ? obj.cards
        .map((c) => c as Partial<KanbanBundleCard>)
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          id: typeof c.id === 'string' ? c.id : undefined,
          cells: c.cells && typeof c.cells === 'object' ? (c.cells as Record<string, unknown>) : {},
          body: typeof c.body === 'string' ? c.body : undefined,
        }))
    : [];
  return { waypointKanban: 1, title: typeof obj.title === 'string' ? obj.title : 'Board', columns, cards };
}

// --- Import: bundle -> plan -------------------------------------------------

function friendlyToCell(
  col: Column,
  optIdByLabel: Map<string, string>,
  value: unknown,
  deps: KanbanImportDeps,
): CellValue | undefined {
  const roster = deps.roster ?? [];
  const nameToId = (name: string) => roster.find((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase())?.id;
  switch (col.type) {
    case 'select':
      return typeof value === 'string' ? optIdByLabel.get(value.trim().toLowerCase()) ?? null : null;
    case 'multiselect': {
      const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      const ids = arr.map((v) => (typeof v === 'string' ? optIdByLabel.get(v.trim().toLowerCase()) : undefined)).filter((x): x is string => !!x);
      return ids;
    }
    case 'person': {
      const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      const ids = arr.map((v) => (typeof v === 'string' ? nameToId(v) : undefined)).filter((x): x is string => !!x);
      return ids;
    }
    case 'checklist': {
      if (!Array.isArray(value)) return undefined;
      const items: ChecklistItem[] = value
        .map((v) => v as { text?: unknown; checked?: unknown; due?: unknown; who?: unknown })
        .filter((v) => v && typeof v.text === 'string')
        .map((v) => {
          const who = typeof v.who === 'string' ? nameToId(v.who) : undefined;
          return {
            id: deps.uid('k'),
            text: v.text as string,
            checked: !!v.checked,
            ...(typeof v.due === 'string' ? { due: v.due } : {}),
            ...(who ? { who } : {}),
          };
        });
      return items.length ? (items as unknown as CellValue) : undefined;
    }
    case 'checkbox':
      return typeof value === 'boolean' ? value : /^(true|yes|1|x)$/i.test(String(value));
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'place': {
      const g = value as Partial<GeoValue>;
      return g && typeof g === 'object' && typeof g.lat === 'number' && typeof g.lon === 'number' && typeof g.name === 'string'
        ? (g as GeoValue)
        : undefined;
    }
    case 'attachment':
      return value && typeof value === 'object' ? (value as CellValue) : undefined;
    default:
      // text, url, date, datetime, reminder
      return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
  }
}

/** Turn a validated bundle into the real columns + card records the store creates. */
export function bundleToBoard(bundle: KanbanBundle, deps: KanbanImportDeps): KanbanImportPlan {
  let colorSeed = 0;
  const columns: Column[] = [];
  const optMaps = new Map<string, Map<string, string>>(); // columnId -> (labelLower -> optionId)

  for (const bc of bundle.columns) {
    const id = deps.uid('c');
    const col: Column = { id, name: bc.name, type: bc.type, width: 180 };
    if ((bc.type === 'select' || bc.type === 'multiselect')) {
      const map = new Map<string, string>();
      col.options = (bc.options ?? []).map((o) => {
        const oid = deps.uid('o');
        map.set(o.label.trim().toLowerCase(), oid);
        return { id: oid, label: o.label, color: o.color || deps.pickColor(colorSeed++), ...(o.done ? { done: true } : {}) };
      });
      optMaps.set(id, map);
    }
    if (bc.type === 'formula' && bc.formula) col.formula = bc.formula;
    if (bc.numberFormat) col.numberFormat = bc.numberFormat;
    if (bc.type === 'reminder' && bc.reminderLead) col.reminderLead = bc.reminderLead;
    if (bc.type === 'person' && bc.peopleMulti) col.peopleMulti = true;
    columns.push(col);
  }

  // The board groups by the column flagged isStage, else the first select.
  const stageIndex = bundle.columns.findIndex((c) => c.isStage && (c.type === 'select' || c.type === 'person'));
  const fallbackIndex = bundle.columns.findIndex((c) => c.type === 'select');
  const groupIdx = stageIndex >= 0 ? stageIndex : fallbackIndex;
  const groupColumnId = groupIdx >= 0 ? columns[groupIdx].id : undefined;

  // Resolve a card's friendly cells against the built columns (by name).
  const colByName = new Map(columns.map((c) => [c.name.trim().toLowerCase(), c]));
  const cards = bundle.cards.map((card) => {
    const cells: Record<string, CellValue> = {};
    for (const [name, value] of Object.entries(card.cells ?? {})) {
      const col = colByName.get(name.trim().toLowerCase());
      if (!col || COMPUTED_TYPES.has(col.type)) continue;
      const cell = friendlyToCell(col, optMaps.get(col.id) ?? new Map(), value, deps);
      if (cell !== undefined) cells[col.id] = cell;
    }
    const body = card.body && card.body.trim() ? (markdownToTiptap(card.body) as unknown as object) : undefined;
    return body ? { cells, body } : { cells };
  });

  return { name: bundle.title || 'Board', columns, groupColumnId, cards };
}

// --- Upsert: bundle -> plan against an existing board -----------------------
// Re-import a previously-exported (or hand-edited) file into the board it came
// from: match each card to a live row and edit in place instead of building a
// fresh board. Matching is by card id first (stamped on export), then by an
// exact, UNIQUE Title for hand-authored cards with no id; anything unmatched is
// added. Nothing is deleted (a card missing from the file is left alone). New
// columns and new select options in the file merge onto the live table; an
// existing column keeps its id and type, so cells still resolve.

/** The live board an upsert edits against: its columns, its rows (id + cells),
 *  and the column it currently groups by (kept as-is). */
export interface KanbanUpsertExisting {
  columns: Column[];
  rows: readonly { id: string; cells: Record<string, CellValue> }[];
  groupColumnId?: string;
}

export interface KanbanUpsertPlan {
  columns: Column[]; // the merged column list to persist (existing + any added)
  columnsChanged: boolean; // false → the table's columns don't need a write
  groupColumnId?: string; // effective board group (the existing one wins)
  updates: { rowId: string; cells: Record<string, CellValue>; body?: object }[];
  creates: { cells: Record<string, CellValue>; body?: object }[];
  updatedCount: number;
  createdCount: number;
}

export function bundleToUpsertPlan(
  bundle: KanbanBundle,
  existing: KanbanUpsertExisting,
  deps: KanbanImportDeps,
): KanbanUpsertPlan {
  let colorSeed = 0;
  let columnsChanged = false;

  // Clone the live columns so the caller's array is never mutated.
  const columns: Column[] = existing.columns.map((c) => ({
    ...c,
    ...(c.options ? { options: c.options.map((o) => ({ ...o })) } : {}),
  }));
  const byName = new Map(columns.map((c) => [c.name.trim().toLowerCase(), c]));
  const optMaps = new Map<string, Map<string, string>>(); // columnId -> labelLower -> optionId
  for (const c of columns) {
    if (c.type === 'select' || c.type === 'multiselect') {
      const m = new Map<string, string>();
      for (const o of c.options ?? []) m.set(o.label.trim().toLowerCase(), o.id);
      optMaps.set(c.id, m);
    }
  }

  for (const bc of bundle.columns) {
    const key = bc.name.trim().toLowerCase();
    const found = byName.get(key);
    if (found) {
      // Merge any select options the file introduced; never retype the column.
      if ((found.type === 'select' || found.type === 'multiselect') && bc.options?.length) {
        const map = optMaps.get(found.id)!;
        const added: SelectOption[] = [];
        for (const o of bc.options) {
          const label = o.label.trim().toLowerCase();
          if (!label || map.has(label)) continue;
          const oid = deps.uid('o');
          map.set(label, oid);
          added.push({ id: oid, label: o.label, color: o.color || deps.pickColor(colorSeed++), ...(o.done ? { done: true } : {}) });
        }
        if (added.length) {
          found.options = [...(found.options ?? []), ...added];
          columnsChanged = true;
        }
      }
      continue;
    }
    // A column the board didn't have: mint it fresh (mirrors bundleToBoard).
    const id = deps.uid('c');
    const col: Column = { id, name: bc.name, type: bc.type, width: 180 };
    if (bc.type === 'select' || bc.type === 'multiselect') {
      const map = new Map<string, string>();
      col.options = (bc.options ?? []).map((o) => {
        const oid = deps.uid('o');
        map.set(o.label.trim().toLowerCase(), oid);
        return { id: oid, label: o.label, color: o.color || deps.pickColor(colorSeed++), ...(o.done ? { done: true } : {}) };
      });
      optMaps.set(id, map);
    }
    if (bc.type === 'formula' && bc.formula) col.formula = bc.formula;
    if (bc.numberFormat) col.numberFormat = bc.numberFormat;
    if (bc.type === 'reminder' && bc.reminderLead) col.reminderLead = bc.reminderLead;
    if (bc.type === 'person' && bc.peopleMulti) col.peopleMulti = true;
    columns.push(col);
    byName.set(key, col);
    columnsChanged = true;
  }

  // Keep the board's current grouping; only derive one if it had none.
  let groupColumnId = existing.groupColumnId;
  if (!groupColumnId) {
    const stageBc = bundle.columns.find((c) => c.isStage && (c.type === 'select' || c.type === 'person'));
    const chosen = stageBc ?? bundle.columns.find((c) => c.type === 'select');
    if (chosen) groupColumnId = byName.get(chosen.name.trim().toLowerCase())?.id;
  }

  // Card identity: id, then a UNIQUE title (first column) for hand-authored files.
  const titleColId = columns[0]?.id;
  const byId = new Map(existing.rows.map((r) => [r.id, r] as const));
  const titleCount = new Map<string, number>();
  const titleToId = new Map<string, string>();
  if (titleColId) {
    for (const r of existing.rows) {
      const t = r.cells[titleColId];
      if (typeof t === 'string' && t.trim()) {
        const k = t.trim().toLowerCase();
        titleCount.set(k, (titleCount.get(k) ?? 0) + 1);
        titleToId.set(k, r.id);
      }
    }
  }

  const colByName = new Map(columns.map((c) => [c.name.trim().toLowerCase(), c]));
  const usedRowIds = new Set<string>();
  const updates: KanbanUpsertPlan['updates'] = [];
  const creates: KanbanUpsertPlan['creates'] = [];

  for (const card of bundle.cards) {
    const cells: Record<string, CellValue> = {};
    for (const [name, value] of Object.entries(card.cells ?? {})) {
      const c = colByName.get(name.trim().toLowerCase());
      if (!c || COMPUTED_TYPES.has(c.type)) continue;
      const cell = friendlyToCell(c, optMaps.get(c.id) ?? new Map(), value, deps);
      if (cell !== undefined) cells[c.id] = cell;
    }
    const body = card.body && card.body.trim() ? (markdownToTiptap(card.body) as unknown as object) : undefined;

    let targetId: string | undefined;
    if (card.id && byId.has(card.id) && !usedRowIds.has(card.id)) {
      targetId = card.id;
    } else if (!card.id && titleColId) {
      const titleVal = cells[titleColId];
      if (typeof titleVal === 'string' && titleVal.trim()) {
        const k = titleVal.trim().toLowerCase();
        const rid = titleCount.get(k) === 1 ? titleToId.get(k) : undefined;
        if (rid && !usedRowIds.has(rid)) targetId = rid;
      }
    }

    if (targetId) {
      usedRowIds.add(targetId);
      updates.push(body ? { rowId: targetId, cells, body } : { rowId: targetId, cells });
    } else {
      creates.push(body ? { cells, body } : { cells });
    }
  }

  return { columns, columnsChanged, groupColumnId, updates, creates, updatedCount: updates.length, createdCount: creates.length };
}

// --- Downloadable template + annotated example ------------------------------

/** An empty board file: the columns present, no cards, so it can be filled in. */
export function blankKanbanBundle(): KanbanBundle {
  return {
    waypointKanban: 1,
    title: 'New board',
    columns: [
      { name: 'Title', type: 'text' },
      { name: 'Stage', type: 'select', isStage: true, options: [{ label: 'To do' }, { label: 'Doing' }, { label: 'Done', done: true }] },
      { name: 'Labels', type: 'multiselect', options: [] },
      { name: 'Assignees', type: 'person', peopleMulti: true },
      { name: 'Due', type: 'date' },
      { name: 'Checklist', type: 'checklist' },
      { name: 'Notes', type: 'text' },
    ],
    cards: [{ cells: { Title: '', Stage: 'To do' }, body: '' }],
  };
}

/** A worked example with guidance embedded, so a person or an AI can see the
 *  shape and fill in their own. `instructions` is ignored on import. */
export function exampleKanbanBundle(): KanbanBundle {
  return {
    waypointKanban: 1,
    title: 'Fukuoka trip board',
    instructions: [
      'This file imports as a Kanban board. Keep this shape and replace the content. The "waypointKanban", "title", "columns" and "cards" keys are required; "instructions" is ignored on import (delete it if you like).',
      'Each object in "columns" is a custom property. "type" is one of: text, number, select, multiselect, date, datetime, checkbox, url, place, attachment, reminder, person, checklist, formula. An unknown type falls back to text. Add or remove columns freely; the first column is the card Title.',
      'Exactly one column should have "isStage": true, that is what the board groups into lanes. It must be a select column (its "options" are the lanes, left to right) or a person column (the lanes are the people). Mark a finished select lane with "done": true so its cards drop off the Home view. If no column is flagged, the first select column becomes the stage.',
      'Each object in "cards" is one card (a row). "cells" is keyed by the column NAME exactly as written above (case-insensitive).',
      'On export each card carries an "id". Re-importing in "update" mode edits the card with that id in place (change its cells and it updates, no duplicate). Remove the "id" and the card is matched by an exact, unique Title, or added as new if there is no unique match. A card missing from the file is left untouched, nothing is deleted.',
      'A select cell is the option LABEL (e.g. "Booked"), not an id, an option you name that is not in "options" is skipped. A multiselect cell is an array of labels. A person cell is an array of member names as they appear in your workspace (unknown names are skipped). A date/datetime cell is an ISO string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm").',
      'A checklist cell is an array of { "text", "checked", optional "due" (YYYY-MM-DD), optional "who" (member name) }.',
      'A place cell is { "name", "lat", "lon" }. A checkbox cell is true/false. A number cell is a plain number; set the column\'s "numberFormat" to plain, comma, yen, sek, eur, usd or percent for display. An attachment cell round-trips only from an export, do not hand-author it.',
      '"body" is markdown and becomes the card\'s page (open the card to see it). Use #/## headings, - bullets, - [ ] / - [x] tasks, **bold**, links. Leave it out for a card with no page.',
      'Formula/rollup/lookup/relation/button/progress columns keep their definition but not values (they recompute), so leave those cells out. Cross-table relations do not reconnect from a standalone file.',
    ],
    columns: [
      { name: 'Title', type: 'text' },
      { name: 'Stage', type: 'select', isStage: true, options: [{ label: 'Ideas' }, { label: 'To book' }, { label: 'Booked' }, { label: 'Done', done: true }] },
      { name: 'Category', type: 'select', options: [{ label: 'Lodging' }, { label: 'Transport' }, { label: 'Food' }, { label: 'Activity' }] },
      { name: 'Tags', type: 'multiselect', options: [{ label: 'must-do' }, { label: 'rainy-day' }, { label: 'kids' }] },
      { name: 'Assignees', type: 'person', peopleMulti: true },
      { name: 'Due', type: 'date' },
      { name: 'Budget', type: 'number', numberFormat: 'yen' },
      { name: 'Checklist', type: 'checklist' },
      { name: 'Notes', type: 'text' },
    ],
    cards: [
      {
        cells: {
          Title: 'Book ryokan in Yufuin',
          Stage: 'To book',
          Category: 'Lodging',
          Tags: ['must-do'],
          Assignees: [],
          Due: '2026-08-10',
          Budget: 42000,
          Checklist: [
            { text: 'Compare two ryokan', checked: true },
            { text: 'Confirm onsen is private', checked: false, due: '2026-08-05' },
          ],
          Notes: 'Two nights, half board.',
        },
        body: '# Yufuin ryokan\n\nWant a room with a private open-air bath.\n\n- [ ] Email about early check-in\n- [ ] Ask about a shuttle from the station\n\nSee **booking.com** and the tourist board site.',
      },
      {
        cells: {
          Title: 'Day trip to Dazaifu',
          Stage: 'Ideas',
          Category: 'Activity',
          Tags: ['rainy-day', 'kids'],
          Due: '2026-08-12',
          Notes: 'Tenmangu shrine plus the plum-blossom mochi.',
        },
        body: '## Dazaifu\n\nTrain from Nishitetsu Fukuoka. Half a day is enough.\n\n1. Tenmangu shrine\n2. Kyushu National Museum\n3. Umegae mochi on the approach',
      },
      {
        cells: { Title: 'Airport transfer', Stage: 'Booked', Category: 'Transport', Budget: 3200, Assignees: [] },
      },
    ],
  };
}

/** Pretty-print a bundle for download (stable 2-space JSON). */
export function serializeBundle(bundle: KanbanBundle): string {
  return JSON.stringify(bundle, null, 2);
}
