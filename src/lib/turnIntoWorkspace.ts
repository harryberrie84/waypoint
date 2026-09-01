// "Turn into workspace": promote a page and its whole sub-page tree into its own
// top-level workspace. This module is the PURE boundary logic (what moves, which
// cross-boundary references to sever, what a revert needs to put back), kept out of
// the store so it can be unit-tested directly. The relocation itself, the crypto,
// the collab reset and the workspace-tier writes live in the store action
// `turnPageIntoWorkspace`, which drives these decisions through the existing guarded
// writers (createPage / renamePage / setCell / setPageContent / resetPageCollab), the
// same way backup restore does, so encryption and the pending-write invariant hold.
//
// The moved set = the converting page + all descendant sub-pages, plus the tables
// embedded in those pages (and each page's kanban board table) and every row of
// those tables. Ids never change on a move, so an untouched cross-boundary reference
// would still "resolve" by id into a workspace the viewer can't see; we sever those
// deliberately rather than lean on id validity.

import type { Page, TableData, TableRow } from '../types';
import { extractTableIds } from './doc';

export interface MovedSet {
  pageIds: string[];
  tableIds: string[];
  rowIds: string[];
}

export interface MovedIds {
  pages: Set<string>;
  rows: Set<string>;
  tables: Set<string>;
}

export function movedIdsOf(set: MovedSet): MovedIds {
  return { pages: new Set(set.pageIds), rows: new Set(set.rowIds), tables: new Set(set.tableIds) };
}

/** The converting page plus every descendant sub-page, roots-first. Trashed pages
 *  are skipped. Guards against a parent cycle (a page can't be its own ancestor). */
export function descendantPageIds(pages: Record<string, Page>, rootId: string): string[] {
  if (!pages[rootId] || pages[rootId].trashed) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const p of Object.values(pages)) {
      if (p.parent === id && !p.trashed) walk(p.id);
    }
  };
  walk(rootId);
  return out;
}

/** Compute the full moved set. `decryptedContent` maps a pageId to its decrypted
 *  TipTap doc (or the plaintext `p.content` for a plaintext page): a locked page's
 *  stored content is an opaque envelope, so embedded-table ids can only be read from
 *  the decrypted doc. A page absent from the map contributes only its kanban table
 *  (its embeds can't be read), a fail-safe rather than a guess. */
export function collectMovedSet(
  pages: Record<string, Page>,
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  rootId: string,
  decryptedContent: Record<string, unknown>,
): MovedSet {
  const pageIds = descendantPageIds(pages, rootId);
  const tableIds = new Set<string>();
  for (const pid of pageIds) {
    const page = pages[pid];
    if (!page) continue;
    const doc = pid in decryptedContent ? decryptedContent[pid] : page.content;
    for (const tid of extractTableIds(doc)) if (tables[tid]) tableIds.add(tid);
    if (page.kanban?.tableId && tables[page.kanban.tableId]) tableIds.add(page.kanban.tableId);
  }
  const rowIds: string[] = [];
  for (const r of Object.values(rows)) if (tableIds.has(r.table)) rowIds.push(r.id);
  return { pageIds, tableIds: [...tableIds], rowIds };
}

// --- cross-boundary references ---------------------------------------------

// A relation cell on a row OUTSIDE the moved set that points at a moved row. We
// remove the moved ids from the array; the rest of the relation is untouched.
export interface RelationSeverance {
  rowId: string;
  columnId: string;
  oldIds: string[];
  newIds: string[];
}

/** Every relation-cell reference from a row OUTSIDE the moved set INTO it. Rollup /
 *  lookup columns are derived, so they recompute once the relation is cut and are
 *  left alone. A row inside the moved set keeps all its relations (they still
 *  resolve by id within the new workspace). */
export function relationSeverances(
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  movedRowIds: Set<string>,
): RelationSeverance[] {
  const out: RelationSeverance[] = [];
  for (const row of Object.values(rows)) {
    if (movedRowIds.has(row.id)) continue; // inside the moved set, leave intact
    const table = tables[row.table];
    if (!table) continue;
    for (const col of table.columns) {
      if (col.type !== 'relation') continue;
      const cell = row.cells[col.id];
      if (!Array.isArray(cell)) continue;
      const oldIds = cell.filter((v): v is string => typeof v === 'string');
      if (!oldIds.some((id) => movedRowIds.has(id))) continue;
      const newIds = oldIds.filter((id) => !movedRowIds.has(id));
      out.push({ rowId: row.id, columnId: col.id, oldIds, newIds });
    }
  }
  return out;
}

// The stored page-link references into the moved set:
//   pageLink -> attrs.pageId (a block link that navigates by id on click)
//   pageRef  -> attrs.pageId (an inline [[...]] link that navigates by id)
// Neutralizing blanks the pageId so the link no longer points into the moved
// workspace (the block becomes an unlinked placeholder, the inline ref plain text).
//
// rowRef, tableEmbed, rollup, lookup and the custom-count card are deliberately NOT
// severed: each resolves LIVE from the store, which is scoped to the workspaces you
// belong to, so a source-workspace member who loses the moved tree simply sees the
// node resolve to nothing (a "missing" chip, an empty embed), exactly like a rollup
// over a cut relation. Only stored pointers that would otherwise dangle by id, page
// links here and relation cells in relationSeverances, are cut.
const REF_ATTR: Record<string, { attr: string; set: keyof MovedIds }> = {
  pageLink: { attr: 'pageId', set: 'pages' },
  pageRef: { attr: 'pageId', set: 'pages' },
};

/** Deep-clone a TipTap doc, blanking any id attr that points into the moved set.
 *  Returns the (possibly new) doc and whether anything changed; when nothing
 *  references the moved set the original is returned untouched, so a page with no
 *  cross-boundary link is never rewritten. */
export function neutralizeCrossRefs(doc: unknown, moved: MovedIds): { doc: unknown; changed: boolean } {
  let changed = false;
  const clone = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(clone);
    if (n && typeof n === 'object') {
      const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
      const out: Record<string, unknown> = { ...node };
      const ref = node.type ? REF_ATTR[node.type] : undefined;
      if (ref && node.attrs) {
        const id = node.attrs[ref.attr];
        if (typeof id === 'string' && id && moved[ref.set].has(id)) {
          out.attrs = { ...node.attrs, [ref.attr]: '' };
          changed = true;
        }
      }
      if (Array.isArray(node.content)) out.content = node.content.map(clone);
      return out;
    }
    return n;
  };
  const next = clone(doc);
  return changed ? { doc: next, changed } : { doc, changed: false };
}

// --- revert snapshot (client-side, no new PocketBase field) -----------------

// What a revert needs to fully reverse the move. The structural + relation parts are
// small and non-sensitive, so they persist to localStorage keyed by an operation id
// (surviving a refresh). The neutralized outside-page docs can be page plaintext, so
// those are held in memory by the store, not written to disk, in an encrypted
// workspace; a refresh before Revert/Accept therefore keeps a best-effort revert
// (structure + relations) but not the content-link restore.

export interface MoveSnapshot {
  opId: string;
  sourceWs: string;
  newWs: string; // the target workspace (created for turn-into, existing for move-into)
  // Source and target encryption are tracked separately so a move BETWEEN a plaintext
  // and an encrypted workspace re-encrypts correctly each way (turn-into-workspace
  // always has source === target). createdWs is true only when the target was created
  // for this move, so revert deletes it (a move into an existing workspace must not).
  sourceEncrypted: boolean;
  targetEncrypted: boolean;
  createdWs: boolean;
  rootPageId: string;
  rootParent: string;
  rootOrder: number;
  pageIds: string[];
  tableIds: string[];
  rowIds: string[];
  relations: RelationSeverance[];
}

const SNAP_KEY = (opId: string) => `waypoint:wsmove:${opId}`;

export function saveMoveSnapshot(snap: MoveSnapshot): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SNAP_KEY(snap.opId), JSON.stringify(snap));
  } catch {
    /* private mode / quota: the in-memory snapshot still drives the live Revert */
  }
}

export function loadMoveSnapshot(opId: string): MoveSnapshot | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SNAP_KEY(opId));
    return raw ? (JSON.parse(raw) as MoveSnapshot) : null;
  } catch {
    return null;
  }
}

export function clearMoveSnapshot(opId: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SNAP_KEY(opId));
  } catch {
    /* ignore */
  }
}

// The pending Revert/Accept notice, persisted so it survives a refresh (the notice
// itself lives in memory; a reload used to drop it even though the snapshot below it
// was still on disk, so a move could become un-revertable just by refreshing).
const PENDING_KEY = 'waypoint:wsmove:pending';

export function savePendingMove(notice: { opId: string; label: string } | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (notice) localStorage.setItem(PENDING_KEY, JSON.stringify(notice));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** The notice to restore on load, if a move is still un-accepted/un-reverted. Falls
 *  back to scanning for an orphan snapshot (a move made before this persistence
 *  existed, e.g. one whose in-memory notice was lost to a refresh) so it can still be
 *  reverted. Returns null when there's nothing pending. */
export function loadPendingMove(): { opId: string; label: string } | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) {
      const n = JSON.parse(raw) as { opId: string; label: string };
      return loadMoveSnapshot(n.opId) ? n : null; // snapshot gone → nothing to revert
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('waypoint:wsmove:') && k !== PENDING_KEY) {
        return { opId: k.slice('waypoint:wsmove:'.length), label: 'a page moved into its own workspace' };
      }
    }
    return null;
  } catch {
    return null;
  }
}
