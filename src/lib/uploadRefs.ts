// Deleting an uploaded file for real is only safe once you know nothing else
// points at it, and in this app the same url is deliberately reused: the Photos
// "just copy" flow duplicates one between the gallery and the body, /audio's "on
// this page" picker exists to reuse a file already uploaded, and a gallery block
// can hold the same image as an inline one. So "removed from this page" never
// means "unused". A delete driven off one removal would break every other page
// still pointing at it, which is the shape of the content-diff GC that once took
// out a live table here.
//
// Pure on purpose: the whole point is that this is testable without a browser.
import { mediaUrlOfNode } from './doc';
import type { Page, TableData, TableRow } from '../types';

/** Where a url is still in use, for a message that names the blocker. */
export interface UploadRef {
  /** 'locked' is NOT a use of the file, it is a page whose body could not be
   *  read. It has to stay distinguishable: treating it as a reference marks
   *  EVERY file as in-use the moment one page anywhere is unreadable, which
   *  makes the whole panel useless rather than cautious. */
  kind: 'body' | 'gallery' | 'photos' | 'files' | 'cover' | 'icon' | 'cell' | 'canvas' | 'workspace' | 'locked';
  pageId?: string;
  tableId?: string;
  rowId?: string;
  /** Human label for the "still used by ..." line. */
  label: string;
}

/**
 * The `uploads` record id out of a served file url. Files are served as
 * `/api/files/<collectionId>/<recordId>/<filename>`, so the id is already in the
 * url and nothing extra has to be stored to find the record again.
 */
export function uploadRecordIdFromUrl(url: string): string | null {
  const m = /\/api\/files\/[^/]+\/([^/?#]+)\//.exec(url);
  return m ? m[1] : null;
}

/** True for a url served by our own uploads collection (not a data: URL or a
 *  remote image), the only kind there is a server record to delete for. */
export function isUploadUrl(url: string): boolean {
  return uploadRecordIdFromUrl(url) !== null;
}

/**
 * Whether two urls point at the same stored file. Compares the RECORD ID, not
 * the string, because the host in a stored url is whatever the app was reached
 * on when the file was added. A staging server cloned from live holds content
 * full of `https://<live-host>/api/files/...` while serving on `127.0.0.1:8099`,
 * so string equality reported every one of those images as unused. Anything
 * that is not an upload (a data: URL, a remote image) still compares exactly.
 */
export function sameUpload(a: string, b: string): boolean {
  if (a === b) return true;
  const ida = uploadRecordIdFromUrl(a);
  return ida !== null && ida === uploadRecordIdFromUrl(b);
}

/** A host-independent key for a file, for Sets and Maps keyed by "which file".
 *  The record id for an upload, the url itself for anything else. */
export function uploadKey(url: string): string {
  return uploadRecordIdFromUrl(url) ?? url;
}

/**
 * Does any string anywhere inside this JSON point at the same stored file?
 *
 * Deliberately blunt. Naming the node types that can hold a picture is what let
 * the sweep report a mindmap image as unused and offer to delete it, and the same
 * miss covered tier-list items, a countdown's cover photo and a custom card's
 * image: none of them is an `image` node, so nothing looked at them. A miss here
 * deletes somebody's photo for good, while a false positive only means refusing
 * to delete a file, so this errs at reading everything.
 *
 * Cheap on the hot path: an upload url is only ever compared against strings that
 * contain the files route, so a cell holding a megabyte of base64 is skipped on a
 * substring test instead of being run through the regex.
 */
export function mentionsUpload(value: unknown, url: string): boolean {
  if (!url) return false;
  const asUpload = isUploadUrl(url);
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 40) return false;
    if (typeof v === 'string') {
      if (asUpload) return v.includes('/api/files/') && sameUpload(v, url);
      return v === url;
    }
    if (!v || typeof v !== 'object') return false;
    if (seen.has(v)) return false; // store objects can be shared; never walk one twice
    seen.add(v);
    if (Array.isArray(v)) return v.some((item) => walk(item, depth + 1));
    return Object.values(v as Record<string, unknown>).some((item) => walk(item, depth + 1));
  };
  return walk(value, 0);
}

function walkBody(nodes: unknown[], url: string, hit: (kind: 'body' | 'gallery') => void): void {
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    const nodeUrl = mediaUrlOfNode(node);
    if (nodeUrl && sameUpload(nodeUrl, url)) hit('body');
    else if (node.type === 'galleryBlock' && Array.isArray(node.attrs?.items)) {
      for (const it of node.attrs.items as { src?: unknown }[]) {
        if (typeof it?.src === 'string' && sameUpload(it.src, url)) hit('gallery');
      }
    } else if (node.attrs && mentionsUpload(node.attrs, url)) {
      // Any other widget holding a picture in its attrs: a tier list's items, a
      // countdown cover, a custom card. mediaUrlOfNode only knows the three media
      // block types, so without this these all read as unused.
      hit('body');
    }
    if (Array.isArray(node.content)) walkBody(node.content, url, hit);
  }
}

/**
 * Every remaining use of `url` across the given pages, tables and rows. An empty
 * result is the only state in which deleting the underlying file is safe.
 *
 * Note this reads DECRYPTED page content, so callers on an encrypted workspace
 * must pass what the store already holds in memory rather than raw envelopes; a
 * page whose body could not be decrypted is reported as a blocker instead of
 * being silently treated as reference-free.
 */
export function referencesToUrl(
  pages: Page[],
  tables: TableData[],
  rows: TableRow[],
  url: string,
  workspaces: { id: string; name?: string; icon?: string }[] = [],
): UploadRef[] {
  const refs: UploadRef[] = [];
  if (!url) return refs;

  for (const page of pages) {
    const title = page.title || 'Untitled';
    const content = page.content;
    if (typeof content === 'string') {
      // An unreadable body (an encrypted page with the vault locked). Reported as
      // 'locked' rather than as a use, so the caller can warn about it once
      // instead of every file looking used.
      refs.push({ kind: 'locked', pageId: page.id, label: title });
    } else if (content && typeof content === 'object') {
      const doc = content as { content?: unknown[] };
      if (Array.isArray(doc.content)) {
        walkBody(doc.content, url, (kind) => refs.push({ kind, pageId: page.id, label: title }));
      }
    }
    if (page.cover && sameUpload(page.cover, url)) refs.push({ kind: 'cover', pageId: page.id, label: `${title} (cover)` });
    // An uploaded page icon is a use like any other. Missing this marked every
    // custom icon and banner as unused, which put them one click from deletion.
    if (page.icon && sameUpload(page.icon, url)) refs.push({ kind: 'icon', pageId: page.id, label: `${title} (icon)` });
    for (const photo of page.photos ?? []) {
      if (photo.url && sameUpload(photo.url, url)) refs.push({ kind: 'photos', pageId: page.id, label: `${title} (gallery)` });
    }
    // Files added from the Files tab. They are not in the body, so nothing above
    // would find them: without this a file you can see listed reads as unused and is
    // one click from deletion, which is the whole reason the tab used to be forced
    // to dump everything into the page body.
    for (const f of page.files ?? []) {
      if (f.url && sameUpload(f.url, url)) refs.push({ kind: 'files', pageId: page.id, label: `${title} (files)` });
    }
    // The page's JSON canvases. None of these is the page BODY, so nothing above
    // ever saw them: a mindmap image node, a tier-list item's picture, an image on
    // a flow node or a board all read as "not used anywhere", which is how the
    // orphan sweep came to offer real, in-use mindmap images for deletion. They
    // are plain JSON, so the deep scan is the whole check.
    for (const [what, canvas] of [
      ['mindmap', page.mindmap],
      ['tier list', page.tierlist],
      ['flow', page.flow],
      ['board', page.kanban],
      ['map', page.map],
      ['currency', page.rates],
    ] as const) {
      if (canvas && mentionsUpload(canvas, url)) refs.push({ kind: 'canvas', pageId: page.id, label: `${title} (${what})` });
    }
  }

  // Workspace icons live outside the page tree entirely, so nothing above would
  // ever have found them.
  for (const ws of workspaces) {
    if (ws.icon && sameUpload(ws.icon, url)) refs.push({ kind: 'workspace', label: `${ws.name || 'Workspace'} (icon)` });
  }

  const tableName = new Map(tables.map((t) => [t.id, t.name || 'Table']));
  for (const row of rows) {
    const label = tableName.get(row.table) ?? 'Table';
    // Any cell, however it holds the reference. This used to read `.data` on an
    // object cell only, so an attachment cell that stores the url some other way
    // (a linked file rather than an inline one) went unseen.
    if (mentionsUpload(row.cells ?? {}, url)) {
      refs.push({ kind: 'cell', tableId: row.table, rowId: row.id, label });
    }
    // The row's own BODY (the kanban card pop-out / "open as page" doc) holds image
    // and file blocks like any page, and was not being swept at all: a photo that
    // lived only in a card body counted as unused and was one click from deletion.
    if (row.contentEnc) {
      refs.push({ kind: 'locked', tableId: row.table, rowId: row.id, label: `${label} (card notes)` });
    } else if (row.content && typeof row.content === 'object') {
      const doc = row.content as { content?: unknown[] };
      if (Array.isArray(doc.content)) {
        walkBody(doc.content, url, (kind) => refs.push({ kind, tableId: row.table, rowId: row.id, label: `${label} (card)` }));
      }
    }
  }
  return refs;
}

/** Split a big upload into parts that each clear the request-body limit. The
 *  parts are reassembled server-side into ONE file, so playback is unchanged. */
export function planChunks(size: number, max: number): { start: number; end: number }[] {
  if (size <= 0 || max <= 0) return [];
  const parts: { start: number; end: number }[] = [];
  for (let start = 0; start < size; start += max) {
    parts.push({ start, end: Math.min(start + max, size) });
  }
  return parts;
}
