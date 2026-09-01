// Restore a workspace from a Waypoint backup. Pure, testable planning helpers
// only; the actual record creation lives in the store action `restoreBackup`,
// which reuses createPage / tablesApi.create / addRow / setCell so encryption +
// workspace stamping stay correct (never writes plaintext into an encrypted
// workspace).
//
// Two on-disk shapes are accepted:
// - v2 (current): one JSON file per entity inside the zip, `data/pages/*.json`
//   and `data/tables/*.json`, plus a small `manifest.json`. Made to be edited by
//   hand or by an AI: each file is self-contained (a table carries its columns
//   AND its rows), and a record missing an `id` is treated as new rather than
//   dropped. `assembleBackup` stitches the files back into one BackupFile.
// - v1 (older zips / bare files): a single monolithic `backup.json`. A lone
//   entity file (one table or one page) also imports on its own.
//
// The backup keeps the ORIGINAL ids. On restore we mint FRESH ids for every
// page, table and row (so a restore never overwrites or collides with existing
// records) and rewrite every reference to an old id, inside page content, cell
// values, and the page's map/mindmap/flow/kanban + the table's views and
// automations, onto the new id, so embeds, page links, row refs, relations and
// kanban boards reconnect. Ids are long random strings, so an exact-string
// remap is safe.

import type { Column, PageMapData, MindmapData, FlowData, KanbanData, Page } from '../types';
import type { Automation } from './automations';
import { extractTableIds } from './doc';

export interface BackupPage {
  id: string;
  title?: string;
  parent?: string;
  workspace?: string;
  icon?: string;
  cover?: string;
  content?: unknown; // a decrypted ProseMirror doc, or null
  map?: PageMapData | null;
  mindmap?: MindmapData | null;
  flow?: FlowData | null;
  kanban?: KanbanData | null;
  // The rest of a page's own data. These were absent for a long time, which meant a
  // backup silently did not carry a page's tier list, its currency board, or the
  // whole Photos/Files attachment list: you only found out at the moment you needed
  // the backup. Every one of them is a plain JSON field on the page, so carrying them
  // costs nothing.
  tierlist?: Page['tierlist'];
  rates?: Page['rates'];
  sheet?: Page['sheet'];
  cards?: Page['cards'];
  rota?: Page['rota'];
  bracket?: Page['bracket'];
  photos?: Page['photos'];
  files?: Page['files'];
  defaultTab?: string;
}

export interface BackupRow {
  id: string;
  parent?: string;
  cells: Record<string, unknown>;
  content?: object | null; // the row's "open as page" body
}

export interface BackupTable {
  id: string;
  name?: string;
  workspace?: string;
  columns: Column[];
  views?: object | null;
  automations?: Automation[] | null;
  rows: BackupRow[];
}

export interface BackupFile {
  workspace?: string;
  exportedAt?: string;
  pages: BackupPage[];
  tables: BackupTable[];
}

/** One decoded zip entry (or a bare file) handed to assembleBackup. */
export interface BackupEntry {
  name: string;
  text: string;
}

type Raw = Record<string, unknown>;

function asObj(v: unknown): Raw | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Ids may be omitted on hand-added records; mint a placeholder that can't
 *  collide with a real id (real ids never start with "__"). The restore mints
 *  fresh server ids for everything anyway; this only keys the remap. */
function makeMinter(): () => string {
  let n = 0;
  return () => `__new__${++n}`;
}

function normalizePage(raw: Raw, mint: () => string): BackupPage {
  return {
    id: str(raw.id) || mint(),
    title: str(raw.title),
    parent: str(raw.parent),
    workspace: str(raw.workspace),
    icon: str(raw.icon),
    cover: str(raw.cover),
    content: raw.content ?? null,
    map: asObj(raw.map) ? (raw.map as PageMapData) : null,
    mindmap: asObj(raw.mindmap) ? (raw.mindmap as MindmapData) : null,
    flow: asObj(raw.flow) ? (raw.flow as FlowData) : null,
    kanban: asObj(raw.kanban) ? (raw.kanban as KanbanData) : null,
    tierlist: asObj(raw.tierlist) ? (raw.tierlist as Page['tierlist']) : null,
    rates: asObj(raw.rates) ? (raw.rates as Page['rates']) : null,
    sheet: asObj(raw.sheet) ? (raw.sheet as Page['sheet']) : null,
    cards: asObj(raw.cards) ? (raw.cards as Page['cards']) : null,
    rota: asObj(raw.rota) ? (raw.rota as Page['rota']) : null,
    bracket: asObj(raw.bracket) ? (raw.bracket as Page['bracket']) : null,
    photos: Array.isArray(raw.photos) ? (raw.photos as Page['photos']) : [],
    files: Array.isArray(raw.files) ? (raw.files as Page['files']) : [],
    defaultTab: str(raw.defaultTab),
  };
}

function normalizeRow(raw: Raw, mint: () => string): BackupRow {
  return {
    id: str(raw.id) || mint(),
    parent: str(raw.parent),
    cells: asObj(raw.cells) ?? {},
    content: asObj(raw.content) ? (raw.content as object) : null,
  };
}

function normalizeTable(raw: Raw, mint: () => string): BackupTable | null {
  if (!Array.isArray(raw.columns)) return null;
  return {
    id: str(raw.id) || mint(),
    name: str(raw.name) || 'Table',
    workspace: str(raw.workspace),
    columns: raw.columns as Column[],
    views: asObj(raw.views),
    automations: Array.isArray(raw.automations) ? (raw.automations as Automation[]) : null,
    rows: Array.isArray(raw.rows) ? raw.rows.map((r) => asObj(r)).filter((r): r is Raw => !!r).map((r) => normalizeRow(r, mint)) : [],
  };
}

/** Parse and validate a backup JSON string: a full backup.json, or a single
 *  entity file (one table, or one page) on its own. Throws a readable error on
 *  bad input. */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  const obj = asObj(raw);
  if (!obj) throw new Error('Not a Waypoint backup (expected a JSON object).');
  const mint = makeMinter();

  if (!Array.isArray(obj.pages) && !Array.isArray(obj.tables)) {
    // A lone entity file: a table carries a columns array, a page a title/content.
    if (Array.isArray(obj.columns)) {
      const t = normalizeTable(obj, mint);
      if (t) return { pages: [], tables: [t] };
    }
    if (typeof obj.title === 'string' || obj.content !== undefined) {
      return { pages: [normalizePage(obj, mint)], tables: [] };
    }
    throw new Error('Not a Waypoint backup (expected "pages" and/or "tables").');
  }

  const pages: BackupPage[] = Array.isArray(obj.pages)
    ? obj.pages.map((p) => asObj(p)).filter((p): p is Raw => !!p).map((p) => normalizePage(p, mint))
    : [];
  const tables: BackupTable[] = Array.isArray(obj.tables)
    ? obj.tables.map((t) => asObj(t)).filter((t): t is Raw => !!t).map((t) => normalizeTable(t, mint)).filter((t): t is BackupTable => !!t)
    : [];
  return { workspace: str(obj.workspace) || undefined, exportedAt: str(obj.exportedAt) || undefined, pages, tables };
}

/** Stitch a v2 zip's entries into one BackupFile: every `data/pages/*.json` and
 *  `data/tables/*.json` (a wrapping folder prefix is tolerated, re-zips often
 *  add one), with `manifest.json` for the metadata. Falls back to a monolithic
 *  `backup.json` when there are no data/ files. A broken entity file names
 *  itself in the error so it can be fixed and re-imported. */
export function assembleBackup(entries: BackupEntry[]): BackupFile {
  const pageFiles = entries.filter((e) => /(^|\/)data\/pages\/[^/]+\.json$/i.test(e.name));
  const tableFiles = entries.filter((e) => /(^|\/)data\/tables\/[^/]+\.json$/i.test(e.name));

  if (pageFiles.length || tableFiles.length) {
    const mint = makeMinter();
    const parseOne = (e: BackupEntry): Raw => {
      let raw: unknown;
      try {
        raw = JSON.parse(e.text);
      } catch {
        throw new Error(`${e.name}: not valid JSON.`);
      }
      const obj = asObj(raw);
      if (!obj) throw new Error(`${e.name}: expected a JSON object.`);
      return obj;
    };
    const pages = pageFiles.map((e) => normalizePage(parseOne(e), mint));
    const tables = tableFiles.map((e) => {
      const t = normalizeTable(parseOne(e), mint);
      if (!t) throw new Error(`${e.name}: a table file needs a "columns" array.`);
      return t;
    });
    let workspace: string | undefined;
    let exportedAt: string | undefined;
    const manifest = entries.find((e) => /(^|\/)manifest\.json$/i.test(e.name));
    if (manifest) {
      try {
        const m = asObj(JSON.parse(manifest.text));
        workspace = str(m?.workspace) || undefined;
        exportedAt = str(m?.exportedAt) || undefined;
      } catch {
        // A broken manifest only loses the label, not the data.
      }
    }
    return { workspace, exportedAt, pages, tables };
  }

  const mono = entries.find((e) => /(^|\/)backup\.json$/i.test(e.name));
  if (mono) return parseBackup(mono.text);
  throw new Error('No Waypoint data in that .zip (expected data/pages/, data/tables/ or backup.json).');
}

/** Deep-clone a value, replacing any string that EXACTLY equals a mapped old id
 *  with its new id. Rewrites references inside page content, cell values, and
 *  the map/mindmap/flow/kanban/views/automations JSON (page links, table
 *  embeds, row refs, relation id arrays, a kanban's tableId; select option ids
 *  are per-table and not in the map, so they're left alone). */
export function remapDeep<T>(value: T, idMap: Map<string, string>): T {
  if (typeof value === 'string') return (idMap.get(value) ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => remapDeep(v, idMap)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = remapDeep(v, idMap);
    return out as unknown as T;
  }
  return value;
}

/** Order pages so a parent is always created before its children (roots first).
 *  A page whose parent isn't in the backup is treated as a root. Guards against a
 *  cycle by falling back to the input order once every remaining page is blocked. */
export function orderPagesByParent(pages: BackupPage[]): BackupPage[] {
  const ids = new Set(pages.map((p) => p.id));
  const done = new Set<string>();
  const out: BackupPage[] = [];
  let remaining = pages.slice();
  while (remaining.length) {
    const ready = remaining.filter((p) => !p.parent || !ids.has(p.parent) || done.has(p.parent));
    if (!ready.length) {
      // A cycle (shouldn't happen in a real tree): append the rest as-is.
      out.push(...remaining);
      break;
    }
    for (const p of ready) {
      out.push(p);
      done.add(p.id);
    }
    const readySet = new Set(ready);
    remaining = remaining.filter((p) => !readySet.has(p));
  }
  return out;
}

export interface RestoreCounts {
  pages: number;
  tables: number;
  rows: number;
}

/** The ids a restore created, so an Undo can delete exactly those and nothing
 *  else. */
export interface RestoreCreated {
  pageIds: string[];
  tableIds: string[];
  rowIds: string[];
}

/** A table's rows + schema captured before a destructive CSV "replace" import,
 *  so an Undo can put the table back exactly as it was. */
export interface TableSnapshot {
  columns: import('../types').Column[];
  views: object | null;
  rows: { cells: Record<string, unknown>; parent: string; content: object | null }[];
}

export interface DeadRefFix {
  pageId: string;
  /** old table id -> restored table id, only the ids this page references */
  remap: Record<string, string>;
  /** the page's plaintext content references a dead id */
  content: boolean;
  /** the page's kanban binding points at a dead id */
  kanban: boolean;
}

/** After a restore, a LIVE page can still point at a table id that no longer
 *  exists (the table was deleted out from under it; the backup holds it under
 *  that same original id). For every old->new pair whose OLD table is gone,
 *  find the live pages still referencing the old id, via a plaintext content
 *  embed or the kanban binding, so the restore can repoint them at the
 *  restored copy. This is what makes "restore a backup" actually heal a page
 *  whose table went missing. An old id that still exists live is left alone
 *  (the normal duplicate-restore case), encrypted content is opaque and
 *  skipped, and pages the restore itself just created are excluded. */
export function deadTableRemaps(
  idMap: Map<string, string>,
  liveTableIds: Set<string>,
  pages: { id: string; content?: unknown; kanban?: { tableId?: string } | null }[],
  skipPageIds: Set<string>,
): DeadRefFix[] {
  const deadMap = new Map<string, string>();
  for (const [oldId, newId] of idMap) {
    if (!liveTableIds.has(oldId) && oldId !== newId) deadMap.set(oldId, newId);
  }
  if (!deadMap.size) return [];
  const fixes: DeadRefFix[] = [];
  for (const p of pages) {
    if (skipPageIds.has(p.id)) continue;
    const remap: Record<string, string> = {};
    let content = false;
    if (p.content && typeof p.content === 'object') {
      for (const tid of extractTableIds(p.content)) {
        const to = deadMap.get(tid);
        if (to) {
          remap[tid] = to;
          content = true;
        }
      }
    }
    let kanban = false;
    const ktid = p.kanban?.tableId;
    if (ktid && deadMap.has(ktid)) {
      remap[ktid] = deadMap.get(ktid)!;
      kanban = true;
    }
    if (content || kanban) fixes.push({ pageId: p.id, remap, content, kanban });
  }
  return fixes;
}

/** The README.md written into every backup zip: the editing contract for a
 *  person or an AI changing the files before re-importing. Kept next to the
 *  parser so the two can't drift apart. */
export const BACKUP_README = `# Waypoint backup

A full copy of one workspace. Import it from Settings -> "Restore a backup":
everything comes back as fresh copies with new ids, nothing existing is
changed or deleted, and every internal reference (page links, table embeds,
relations, kanban boards) is rewritten to the new copies automatically.

## Layout

- manifest.json           which workspace, when it was exported
- data/pages/<name>.json  one file per page. IMPORTED.
- data/tables/<name>.json one file per table: its columns AND all rows. IMPORTED.
- pages/<name>.md         readable preview of a page. Ignored on import.
- tables/<name>.csv       readable preview of a table. Ignored on import.
- README.md               this file. Ignored on import.

Only manifest.json and the data/ files are read on import. To change the
backup, edit the data/ files, keep the folder layout, re-zip, import the zip.
A single data/ .json file also imports on its own, without the zip.

## Editing the files (rules for a person or an AI)

A table file:

    {
      "id": "abc123...",           original id; leave it alone
      "name": "Packing",
      "columns": [ { "id": "c1", "name": "Item", "type": "text", ... } ],
      "views": { ... },            view config (filters, colours, board setup)
      "automations": [ ... ],      table automations, or null
      "rows": [
        { "id": "r1...", "parent": "", "cells": { "c1": "Toothbrush" }, "content": null }
      ]
    }

A page file:

    {
      "id": "p1...",
      "title": "Tokyo",
      "parent": "",                id of another page in this backup, or ""
      "icon": "🗼", "cover": "",
      "content": { "type": "doc", "content": [ ... ] },
      "map": null, "mindmap": null, "flow": null,
      "kanban": { "tableId": "abc123..." },
      "tierlist": null, "rates": null, "sheet": null, "cards": null, "rota": null, "bracket": null,
      "photos": [], "files": [],
      "defaultTab": ""
    }

- cells are keyed by COLUMN ID: the keys of "cells" are the "id" values in the
  same file's "columns" array. Look the column up by name there first.
- a select/multiselect cell stores OPTION IDS, not labels: the "id" values in
  that column's "options" array (multiselect = an array of them). To use a new
  label, add an option (fresh id, a label, a color like "#e05a86") to the
  column first, then put its id in the cell.
- a relation cell is an array of row ids from the related table's file. A
  person cell holds user ids; leave those alone.
- dates are "YYYY-MM-DD", datetimes ISO 8601. Checkboxes are true/false.
- formula/rollup/lookup cells are computed; leave their cells empty.
- an attachment cell / image src is a base64 data URL; leave those alone.
- page "content" and a row's "content" are TipTap JSON. Edit the "text" values
  inside, keep the node structure.
- ADD a row/page: copy an existing one and either give it a new unique "id"
  string or leave "id" out entirely. Never reuse an existing id.
- ADD a table: add a data/tables/<name>.json file with "columns" and "rows".
  Reference it from a page by putting its id in the page's "kanban".tableId or
  in a tableEmbed node inside "content".
- REMOVE a row/page/table: delete it from the file (or delete the file).
  Importing never deletes anything in the app.
- a kanban board is just a table: the board's page carries
  "kanban": { "tableId": ... } and the table's "views".groupColumnId names the
  select column whose options are the lanes (left to right; "done": true on an
  option marks the finished lane). Cards are rows; a card's body is the row's
  "content".
- "photos" and "files" are the Photos and Files tab lists. Each entry keeps a
  "url" pointing at an upload on the server it came from, so those resolve on a
  restore into the SAME server and are dead links anywhere else (the same is
  true of images inside "content"). The files themselves are not in this zip.
- "tierlist", "rates" and "sheet" are the Tier list, Currency and Sheet tab
  boards. "rates" and "sheet" need the matching pages column on the destination
  server, or they are skipped.
`;
