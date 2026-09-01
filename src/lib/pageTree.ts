// Pure selectors over the page / table / row maps. Lifted out of the store so the
// test harness (scripts/tests.ts, which imports only from lib/) can reach them
// directly, and so the tangle in useData.ts shrinks toward orchestration only.
// Nothing here touches the network, the store, or any singleton: data in, data out.

import type { Page, TableData, TableRow } from '../types';

export function selectChildren(pages: Record<string, Page>, parentId: string): Page[] {
  return Object.values(pages)
    .filter((p) => p.parent === parentId && !p.trashed)
    .sort((a, b) => a.order - b.order);
}

export function selectTopLevel(pages: Record<string, Page>): Page[] {
  // Root pages are those whose parent is '' . There is conceptually one root
  // workspace; we render its children as the top of the sidebar tree.
  const roots = Object.values(pages).filter((p) => p.parent === '' && !p.trashed);
  return roots.sort((a, b) => a.order - b.order);
}

export function selectTemplates(pages: Record<string, Page>): Page[] {
  return Object.values(pages)
    .filter((p) => p.template && !p.trashed)
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

/**
 * Trashed pages that are the *root* of a trashed subtree (their parent is not
 * itself trashed). Restoring one of these brings its whole subtree back.
 */
export function selectTrashRoots(pages: Record<string, Page>): Page[] {
  return Object.values(pages)
    .filter((p) => p.trashed && !(p.parent && pages[p.parent]?.trashed))
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}

// A page belongs to a workspace via its `workspace` field; legacy pages with an
// empty field fall into the default bucket (pre-migration, the only workspace).
export function pageWorkspaceId(page: Page, defaultId: string): string {
  return page.workspace || defaultId;
}

/**
 * "Unfiled" pages: pages that belong to a workspace but can't be reached from its
 * sidebar tree, because their parent isn't a live page IN THIS workspace (it's
 * missing, trashed, or lives in another workspace). They still exist and are
 * findable (search, the /page picker), they just render nowhere. This happens after
 * a Notion import that misplaced a parent, or a partial workspace move that stranded
 * children under a parent that stayed behind.
 *
 * Only the TOP of each orphaned subtree is returned: a page whose parent IS a live
 * in-workspace page nests under it and shouldn't be surfaced (re-filing the top
 * brings the rest with it, since the sidebar resolves children from the full store).
 * The UI surfaces these so they can be re-filed (made top-level, or moved under a
 * page) without ever duplicating them. A healthy workspace returns an empty list.
 */
export function selectUnfiledPages(
  pages: Record<string, Page>,
  activeId: string | null,
  defaultId: string,
): Page[] {
  if (!activeId) return [];
  const inWorkspace = (p: Page | undefined): boolean =>
    !!p && !p.trashed && pageWorkspaceId(p, defaultId) === activeId;

  // A page reached from another page in this workspace, via a body link/embed
  // (pageLink/pageRef), a mindmap page-node, a flow node, or a kanban binding,
  // is NOT lost even if its own `parent` is orphaned: you can still open it from
  // there. Collect every referenced page id so we don't surface a reachable page
  // as "not in the list" (the reported false-positive). Over-inclusion only
  // shrinks this recovery list, it can never hide a page from the actual tree.
  const reachable = new Set<string>();
  for (const p of Object.values(pages)) {
    if (!inWorkspace(p)) continue;
    collectReferencedPageIds(p.content, reachable);
    collectReferencedPageIds(p.mindmap, reachable);
    collectReferencedPageIds(p.flow, reachable);
    collectReferencedPageIds(p.kanban, reachable);
  }

  const out: Page[] = [];
  for (const p of Object.values(pages)) {
    if (!inWorkspace(p) || p.parent === '') continue; // gone, elsewhere, or a real root
    if (reachable.has(p.id)) continue; // reachable via another page's link/embed/tab
    if (!inWorkspace(pages[p.parent])) out.push(p); // parent not a live page here → orphaned top
  }
  return out.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

/** Deep-scan a page's rich field for referenced page ids (any `pageId` string:
 *  pageLink/pageRef nodes, mindmap page-nodes, flow nodes). A decrypted doc is a
 *  plain object here; an undecrypted envelope is a string and yields nothing. */
function collectReferencedPageIds(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) collectReferencedPageIds(v, out);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'pageId' && typeof v === 'string' && v) out.add(v);
    else collectReferencedPageIds(v, out);
  }
}

// Subset of pages scoped to one workspace, for the sidebar tree. Empty-workspace
// pages resolve into `defaultId`. A null activeId means "no scoping" (show all).
export function selectWorkspacePages(
  pages: Record<string, Page>,
  activeId: string | null,
  defaultId: string,
): Record<string, Page> {
  if (!activeId) return pages;
  const out: Record<string, Page> = {};
  for (const p of Object.values(pages)) if (pageWorkspaceId(p, defaultId) === activeId) out[p.id] = p;
  return out;
}

// Tables scoped to one workspace, for pickers (relations, flow/automation
// targets, mindmap nodes) so they never reach across workspaces you're a member
// of. Same default-bucket rule as pages.
export function selectWorkspaceTables(
  tables: Record<string, TableData>,
  activeId: string | null,
  defaultId: string,
): TableData[] {
  const all = Object.values(tables);
  if (!activeId) return all;
  return all.filter((t) => (t.workspace || defaultId) === activeId);
}

export function selectBreadcrumb(pages: Record<string, Page>, id: string | null): Page[] {
  const trail: Page[] = [];
  let cursor = id;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const p: Page | undefined = pages[cursor];
    if (!p) break;
    trail.unshift(p);
    cursor = p.parent || null;
  }
  return trail;
}

export function selectRowsForTable(rows: Record<string, TableRow>, tableId: string): TableRow[] {
  return Object.values(rows)
    .filter((r) => r.table === tableId)
    .sort((a, b) => a.position - b.position || a.created.localeCompare(b.created));
}
