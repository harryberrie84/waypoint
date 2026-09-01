// Parse a Notion HTML/Markdown export (the .zip) into an import plan: workspaces
// (the top-level folders), pages (every .md, keeping the subpage tree from the
// folder layout), and databases (every *_all.csv becomes a table). The markdown
// body of each page is converted to a TipTap doc.
//
// Notion's filename convention is "<Title> <32-hex id>.md" (or "..._all.csv" for a
// database), and a page with children also has a sibling folder "<Title> <id>/"
// holding them. So a page's parent is the id embedded in its containing folder.

import type { ZipEntry } from './unzip';

// --- markdown -> TipTap -----------------------------------------------------

interface TNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function text(value: string, marks?: TNode['marks']): TNode | null {
  if (!value) return null;
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

// A Notion in-export link points at "<path>/<title> <id>.md" (or "..._all.csv"
// for a database). Pull the 32-hex id so the link can be re-pointed at the page
// once it's imported. External (http) links return null.
export function notionPageRef(href: string): string | null {
  let h = href;
  try {
    h = decodeURIComponent(href);
  } catch {
    /* keep the raw href */
  }
  const m = /([0-9a-f]{32})(?:_all)?\.(?:md|csv)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function isPageLinkLine(line: string): boolean {
  const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(line.trim());
  return !!(m && notionPageRef(m[2]));
}

// Inline marks: **bold**, *italic* / _italic_, `code`, [text](url). One level,
// which covers the overwhelming majority of exported prose.
export function parseInline(input: string): TNode[] {
  const out: TNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(__([^_]+)__)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const before = input.slice(last, m.index);
    const t = text(before);
    if (t) out.push(t);
    let node: TNode | null = null;
    if (m[1]) node = text(m[2], [{ type: 'bold' }]);
    else if (m[3]) node = text(m[4], [{ type: 'italic' }]);
    else if (m[5]) node = text(m[6], [{ type: 'bold' }]);
    else if (m[7]) node = text(m[8], [{ type: 'italic' }]);
    else if (m[9]) node = text(m[10], [{ type: 'code' }]);
    else if (m[11]) {
      // An inline link to another exported page becomes a live inline pageRef,
      // carrying the source id so the importer can re-point it once every page
      // lands (before, it was flattened to plain text and the reference was lost).
      const ref = notionPageRef(m[13]);
      node = ref
        ? { type: 'pageRef', attrs: { pageId: '', notionId: ref, label: m[12] } }
        : text(m[12], [{ type: 'link', attrs: { href: m[13] } }]);
    }
    if (node) out.push(node);
    last = m.index + m[0].length;
  }
  const tail = text(input.slice(last));
  if (tail) out.push(tail);
  return out;
}

interface ItemInfo {
  indent: number;
  kind: 'bullet' | 'ordered' | 'task';
  checked: boolean;
  body: string;
}
function itemInfo(line: string): ItemInfo | null {
  const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
  if (!m) return null;
  const indent = m[1].replace(/\t/g, '    ').length;
  const ordered = /\d+\./.test(m[2]);
  let body = m[3];
  let kind: ItemInfo['kind'] = ordered ? 'ordered' : 'bullet';
  let checked = false;
  const t = /^\[([ xX])\]\s+(.*)$/.exec(body);
  if (t) {
    kind = 'task';
    checked = t[1].toLowerCase() === 'x';
    body = t[2];
  }
  return { indent, kind, checked, body };
}

function parseList(lines: string[], start: number): { node: TNode; next: number } {
  const base = itemInfo(lines[start]) as ItemInfo;
  const items: TNode[] = [];
  let i = start;
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      // allow a single blank line between items
      if (i + 1 < lines.length && itemInfo(lines[i + 1])) {
        i++;
        continue;
      }
      break;
    }
    const info = itemInfo(lines[i]);
    if (!info || info.indent < base.indent || info.kind !== base.kind) break;
    if (info.indent > base.indent) break; // safety; deeper handled as nested below
    const itemContent: TNode[] = [{ type: 'paragraph', content: parseInline(info.body) }];
    i++;
    const peek = i < lines.length && lines[i].trim() !== '' ? itemInfo(lines[i]) : null;
    if (peek && peek.indent > base.indent) {
      const sub = parseList(lines, i);
      itemContent.push(sub.node);
      i = sub.next;
    }
    items.push(
      base.kind === 'task'
        ? { type: 'taskItem', attrs: { checked: info.checked }, content: itemContent }
        : { type: 'listItem', content: itemContent },
    );
  }
  const type = base.kind === 'task' ? 'taskList' : base.kind === 'ordered' ? 'orderedList' : 'bulletList';
  return { node: { type, content: items }, next: i };
}

const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const IMG = /^!\[[^\]]*\]\([^)]+\)\s*$/;
function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^\s*([-*+]|\d+\.)\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^```/.test(line.trim()) ||
    HR.test(line) ||
    IMG.test(line.trim()) ||
    isPageLinkLine(line)
  );
}

export function markdownToTiptap(md: string, resolveImage?: (rawRef: string) => string | null): TNode {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: TNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) code.push(lines[i++]);
      i++;
      blocks.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', attrs: { level: Math.min(3, h[1].length) }, content: parseInline(h[2].trim()) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ type: 'horizontalRule' });
      i++;
      continue;
    }
    if (IMG.test(line.trim())) {
      const im = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
      if (im) {
        const alt = im[1];
        const ref = im[2].trim();
        if (/^https?:\/\//i.test(ref)) {
          blocks.push({ type: 'image', attrs: { src: ref, alt } }); // external image, keep as-is
        } else {
          // A local export image: emit a block with the source key so the store can
          // upload it and fill src (see resolveImportedImages). Unresolvable → skip.
          const key = resolveImage?.(ref) ?? null;
          if (key) blocks.push({ type: 'image', attrs: { src: '', alt, importKey: key } });
        }
      }
      i++;
      continue;
    }
    // A standalone link to another exported page becomes a real pageLink, carrying
    // the source id + title so the importer can re-point it after every page lands.
    const pageLink = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(line.trim());
    if (pageLink) {
      const ref = notionPageRef(pageLink[2]);
      if (ref) {
        blocks.push({ type: 'pageLink', attrs: { pageId: '', notionId: ref, label: pageLink[1] } });
        i++;
        continue;
      }
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'blockquote', content: [{ type: 'paragraph', content: parseInline(q.join(' ').trim()) }] });
      continue;
    }
    if (itemInfo(line)) {
      const { node, next } = parseList(lines, i);
      blocks.push(node);
      i = next;
      continue;
    }
    // paragraph: gather until a blank line or a new block starts
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) para.push(lines[i++]);
    const content = parseInline(para.join(' ').trim());
    blocks.push(content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
  }
  if (!blocks.length) blocks.push({ type: 'paragraph' });
  return { type: 'doc', content: blocks };
}

// --- structure --------------------------------------------------------------

export interface ImportPage {
  notionId: string;
  title: string;
  parentId: string | null;
  content: TNode;
  csv?: string; // present when this page is a database (its _all.csv text)
}
export interface ImportWorkspace {
  name: string;
  pages: ImportPage[];
}
// An image file from the export that a page body references. Carried as raw bytes so
// the store can upload it (full resolution) and re-point the image block's src, the
// same shape as the page-link re-point. `key` is unique across the whole plan.
export interface ImportImage {
  key: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}
export interface ImportPlan {
  workspaces: ImportWorkspace[];
  images: ImportImage[];
  skippedImages: number;
}

const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};
function imageMime(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? IMAGE_EXT_MIME[ext] ?? null : null;
}
function decodeMaybe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
// Collapse "." / ".." and empty segments so a markdown ref resolves to a zip path.
function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}
// Resolve a markdown image ref (relative, url-encoded) against the page's folder to a
// zip entry path. Returns null for an external/data URL or a ref we can't locate.
function resolveImagePath(pageDir: string, rawRef: string, byPath: Map<string, unknown>): string | null {
  const ref = decodeMaybe(rawRef).trim();
  if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return null; // http(s):, data:, mailto: ... not a zip file
  const norm = normalizePath(pageDir ? `${pageDir}/${ref}` : ref);
  return byPath.has(norm) ? norm : null;
}

const ID_RE = /([0-9a-f]{32})$/;
function idOf(nameNoExt: string): string | null {
  const m = ID_RE.exec(nameNoExt.trim());
  return m ? m[1] : null;
}
function titleOf(nameNoExt: string): string {
  return nameNoExt.replace(/\s*[0-9a-f]{32}$/, '').trim() || 'Untitled';
}
function firstHeading(md: string): { title: string | null; body: string } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let idx = 0;
  while (idx < lines.length && lines[idx].trim() === '') idx++;
  const h = idx < lines.length ? /^#\s+(.*)$/.exec(lines[idx]) : null;
  if (h) return { title: h[1].trim(), body: lines.slice(idx + 1).join('\n') };
  return { title: null, body: md };
}

export function parseNotionExport(entries: ZipEntry[]): ImportPlan {
  const decoder = new TextDecoder('utf-8');
  // Strip the leading "Export-<uuid>/" wrapper that Notion always adds.
  const stripped = entries.map((e) => ({ ...e, path: e.name.replace(/^Export-[^/]+\//, '') }));
  // Group by the first remaining segment (the space / teamspace) -> a workspace.
  const byWorkspace = new Map<string, typeof stripped>();
  for (const e of stripped) {
    const slash = e.path.indexOf('/');
    const ws = slash >= 0 ? e.path.slice(0, slash) : '';
    if (!ws) continue; // a stray top-level file, ignore
    const rel = e.path.slice(slash + 1);
    const list = byWorkspace.get(ws) ?? [];
    list.push({ ...e, path: rel });
    byWorkspace.set(ws, list);
  }

  let skippedImages = 0;
  const workspaces: ImportWorkspace[] = [];
  const allImages: ImportImage[] = [];

  for (const [wsName, files] of byWorkspace) {
    // ids that are databases (have an _all.csv).
    const dbIds = new Set<string>();
    for (const f of files) {
      if (f.path.endsWith('_all.csv')) {
        const base = f.path.split('/').pop()!.replace(/_all\.csv$/, '');
        const id = idOf(base);
        if (id) dbIds.add(id);
      }
    }
    // csv text by db id.
    const csvById = new Map<string, string>();
    // image files by their (normalized) path, so a page body's ref can be matched.
    const imagesByPath = new Map<string, { name: string; mime: string; bytes: Uint8Array }>();
    for (const f of files) {
      if (f.path.endsWith('_all.csv')) {
        const base = f.path.split('/').pop()!.replace(/_all\.csv$/, '');
        const id = idOf(base);
        if (id) csvById.set(id, decoder.decode(f.bytes));
      }
      const mime = imageMime(f.path);
      if (mime) imagesByPath.set(normalizePath(f.path), { name: f.path.split('/').pop() || 'image', mime, bytes: f.bytes });
    }
    // Images this workspace's pages actually reference; the rest count as skipped.
    const usedImages = new Map<string, ImportImage>();
    const makeResolve = (pageDir: string) => (rawRef: string): string | null => {
      const rel = resolveImagePath(pageDir, rawRef, imagesByPath);
      if (!rel) return null;
      const key = `${wsName}/${rel}`;
      if (!usedImages.has(key)) {
        const e = imagesByPath.get(rel)!;
        usedImages.set(key, { key, name: e.name, mime: e.mime, bytes: e.bytes });
      }
      return key;
    };

    // First pass: read every page and record which child folder it owns. Notion
    // names a page file "<dir>/Title <id>.md" but its children's folder is just
    // "<dir>/Title" (no id), so a child's parent is the page whose title matches
    // the folder it sits in.
    interface Raw {
      id: string;
      fileTitle: string;
      displayTitle: string;
      dirPath: string;
      body: string;
      isDb: boolean;
    }
    const raws: Raw[] = [];
    const pageIds = new Set<string>(); // every page id in this workspace
    const ownerByFolderTitle = new Map<string, string>(); // <dir>/<title> -> id (old no-id folders)
    for (const f of files) {
      if (!f.path.endsWith('.md')) continue;
      const segments = f.path.split('/');
      const fileBase = segments.pop()!.replace(/\.md$/, '');
      const id = idOf(fileBase);
      if (!id) continue;
      const dirPath = segments.join('/');
      const fileTitle = titleOf(fileBase);
      const md = decoder.decode(f.bytes);
      const { title: headingTitle, body } = firstHeading(md);
      raws.push({ id, fileTitle, displayTitle: headingTitle || fileTitle, dirPath, body, isDb: dbIds.has(id) });
      pageIds.add(id);
      // Only used as a fallback for old exports whose child folders carried no id;
      // don't overwrite an existing key, so a duplicate title can't hijack it.
      const key = dirPath ? `${dirPath}/${fileTitle}` : fileTitle;
      if (!ownerByFolderTitle.has(key)) ownerByFolderTitle.set(key, id);
    }

    // A child's containing folder is named like its parent's file base, "<Title> <id>",
    // so pull the parent id straight from the id at the end of that folder name. That's
    // unambiguous even when two pages share a title (the old title-only match collided
    // and stranded children at the top level). Fall back to the title map for older
    // exports whose folders had no id.
    const resolveParent = (dirPath: string): string | null => {
      if (!dirPath) return null;
      const lastSeg = dirPath.split('/').pop() ?? '';
      const folderId = idOf(lastSeg);
      if (folderId && pageIds.has(folderId)) return folderId;
      return ownerByFolderTitle.get(dirPath) ?? null;
    };

    // Second pass: resolve each page's parent from the folder it lives in, and
    // drop a database's row sub-pages (the CSV already holds them).
    const pages: ImportPage[] = [];
    for (const r of raws) {
      const parentId = resolveParent(r.dirPath);
      if (parentId && dbIds.has(parentId)) continue;
      if (r.isDb) {
        pages.push({ notionId: r.id, title: r.displayTitle, parentId, content: { type: 'doc', content: [{ type: 'paragraph' }] }, csv: csvById.get(r.id) });
      } else {
        pages.push({ notionId: r.id, title: r.displayTitle, parentId, content: markdownToTiptap(r.body, makeResolve(r.dirPath)) });
      }
    }

    if (pages.length) workspaces.push({ name: wsName, pages });
    allImages.push(...usedImages.values());
    skippedImages += imagesByPath.size - usedImages.size; // in the export but not pulled into a page
  }

  return { workspaces, images: allImages, skippedImages };
}
