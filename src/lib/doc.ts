// Tiny helpers for TipTap document shapes, kept pure and dependency-free so the
// data-loss guards that use them can be unit-tested.

/**
 * True for a TipTap doc that holds nothing: no nodes, or only empty paragraphs.
 * The data layer uses this to refuse overwriting real page content with an empty
 * editor reset (the signature of a failed decrypt or a cross-device encrypt race).
 */
export function isEmptyDoc(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const doc = c as { type?: string; content?: unknown[] };
  if (doc.type !== 'doc') return false;
  const kids = doc.content ?? [];
  if (kids.length === 0) return true;
  return kids.every((n) => {
    const node = n as { type?: string; content?: unknown[] };
    return node.type === 'paragraph' && (!node.content || node.content.length === 0);
  });
}

// TipTap node types that are ordinary text scaffolding, holding no standalone
// data. Everything outside this set is a widget/block (a countdown, setlist,
// table embed, image, recipe card, chart...) whose silent loss is the data-loss
// case the plaintext guard defends. It's an allowlist by design: a newly added
// widget block is protected automatically, without having to touch this file.
const PLAIN_TYPES = new Set([
  'doc', 'paragraph', 'text', 'heading', 'hardBreak', 'horizontalRule',
  'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote',
]);
// Inside these, the inline children (a mention, page ref, inline formula) are
// text-level, not standalone blocks, so they don't count as a widget.
const TEXT_CONTAINERS = new Set(['paragraph', 'heading']);

/** Type-level twin of hasWidgetBlock, for callers that hold a live ProseMirror
 *  node: is this node type a widget block (data-bearing), not plain scaffolding?
 *  Pair it with the node's own isBlock/isInline so inline refs don't count.
 *  Same allowlist as hasWidgetBlock, so new widgets are covered automatically. */
export function isWidgetType(type: string): boolean {
  return !PLAIN_TYPES.has(type);
}

/**
 * True if a TipTap doc contains a block-level widget: anything past plain text
 * scaffolding (a countdown, setlist, table embed, image, card, chart...).
 * Inline references living inside a paragraph/heading don't count. The data
 * layer uses this to refuse blanking a plaintext page that holds a widget, the
 * plaintext twin of the encrypted empty-over-envelope guard.
 */
export function hasWidgetBlock(content: unknown): boolean {
  let found = false;
  const walk = (n: unknown, parentType?: string) => {
    if (found || !n || typeof n !== 'object') return;
    const node = n as { type?: string; content?: unknown[] };
    const t = node.type;
    const inlineInText = parentType !== undefined && TEXT_CONTAINERS.has(parentType);
    if (t && !PLAIN_TYPES.has(t) && !inlineInText) {
      found = true;
      return;
    }
    if (Array.isArray(node.content)) node.content.forEach((c) => walk(c, t));
  };
  walk(content);
  return found;
}

type JsonNode = { type?: string; attrs?: Record<string, unknown>; content?: JsonNode[] } & Record<string, unknown>;

/** Collect tableEmbed tableIds anywhere in a TipTap content doc. */
/** The URL a media block points at, whatever kind it is. `image` and `audioBlock`
 *  keep it on `src`, a `fileBlock` keeps it on `data` (an uploaded URL, or an
 *  inline data URL for a small attachment). Detach paths matched only `image`
 *  once, so removing a video or a PDF silently found nothing. */
export function mediaUrlOfNode(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type?: string; attrs?: Record<string, unknown> };
  const attr = n.type === 'fileBlock' ? n.attrs?.data : n.type === 'image' || n.type === 'audioBlock' ? n.attrs?.src : undefined;
  return typeof attr === 'string' && attr ? attr : null;
}

export function extractTableIds(content: unknown): string[] {
  const ids = new Set<string>();
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as JsonNode;
    if (node.type === 'tableEmbed' && node.attrs && typeof node.attrs.tableId === 'string') ids.add(node.attrs.tableId);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(content);
  return [...ids];
}

/**
 * Return a deep copy of a TipTap doc with the FIRST image node whose `src` matches
 * given a `threadId` (only when it has none yet), so a comment started from the
 * Moodboard lightbox anchors to the same image the editor badges in the body.
 * Returns null when there's nothing to anchor to (no matching image, or it already
 * carries a thread), so the caller can skip the write.
 */
export function setImageThreadId(content: unknown, src: string, threadId: string): unknown | null {
  let done = false;
  const clone = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(clone);
    if (n && typeof n === 'object') {
      const node = n as JsonNode;
      const out: JsonNode = { ...node };
      if (!done && node.type === 'image' && node.attrs && node.attrs.src === src && !node.attrs.threadId) {
        out.attrs = { ...node.attrs, threadId };
        done = true;
      }
      if (Array.isArray(node.content)) out.content = node.content.map(clone) as JsonNode[];
      return out;
    }
    return n;
  };
  const next = clone(content);
  return done ? next : null;
}

/** Deep-copy a content doc, rewriting tableEmbed ids per the map. */
export function remapTableIds(content: unknown, map: Record<string, string>): unknown {
  const clone = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(clone);
    if (n && typeof n === 'object') {
      const node = n as JsonNode;
      const out: JsonNode = { ...node };
      if (
        node.type === 'tableEmbed' &&
        node.attrs &&
        typeof node.attrs.tableId === 'string' &&
        map[node.attrs.tableId]
      ) {
        out.attrs = { ...node.attrs, tableId: map[node.attrs.tableId] };
      }
      if (Array.isArray(node.content)) out.content = node.content.map(clone) as JsonNode[];
      return out;
    }
    return n;
  };
  return clone(content);
}
