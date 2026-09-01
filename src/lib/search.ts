import type { Comment, Page, TableData, TableRow } from '../types';
import { cellText, titleColumn } from './tableQuery';
import { isEnvelope } from './crypto';

// ---------------------------------------------------------------------------
// Lightweight client-side search.
// ---------------------------------------------------------------------------
// Everything is already in memory (the Zustand store mirrors the whole
// workspace), so quick-find needs no server round-trip and no dependency. We
// flatten each page's TipTap body and each table row's cells into one searchable
// document, build that index once per data change (not per keystroke), then run
// a small subsequence fuzzy matcher with word-boundary bonuses against it.
//
// Pages and table rows are both searchable so "where did I write the wifi
// password" finds it whether it's a note or a cell. Comments aren't mirrored in
// the store (they're fetched per page), so they're out of scope here.

// Attr keys that hold ids, urls, colours or other non-text, skipped so they don't
// pollute search. Everything else stringy is readable content.
const NON_TEXT_ATTRS = new Set(['id', 'pageId', 'tableId', 'notionId', 'src', 'href', 'url', 'link', 'color', 'base', 'image', 'timezone']);

/** Readable strings out of a node's attrs (widget fields like a case brief's
 *  facts, a recipe's ingredients, a page link's label all live in attrs). */
export function attrText(attrs: Record<string, unknown>): string {
  let out = '';
  for (const [key, value] of Object.entries(attrs)) {
    if (NON_TEXT_ATTRS.has(key)) continue;
    if (typeof value === 'string') {
      out += value + ' ';
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') out += item + ' ';
        else if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
          out += (item as { text: string }).text + ' ';
        }
      }
    }
  }
  return out;
}

/** Recursively pull visible text out of a TipTap/ProseMirror JSON doc, including
 *  the text that atom/widget nodes keep in their attrs. */
export function extractPlainText(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const node = content as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  let out = '';
  if (typeof node.text === 'string') out += node.text + ' ';
  if (node.attrs && typeof node.attrs === 'object') out += attrText(node.attrs);
  if (Array.isArray(node.content)) {
    for (const child of node.content) out += extractPlainText(child);
  }
  return out;
}

/**
 * Fuzzy subsequence score. Returns a number where higher is better, or -1 for
 * no match. Rewards contiguous runs, matches at word boundaries, and an exact
 * substring hit.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (!t) return -1;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    // Exact substring: strong base score, bonus for hitting the start / a word boundary.
    const boundary = idx === 0 || /\s/.test(t[idx - 1]) ? 40 : 0;
    return 100 + boundary - Math.min(idx, 30);
  }

  // Subsequence match.
  let ti = 0;
  let score = 0;
  let run = 0;
  let matched = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] === ch) {
        found = k;
        break;
      }
    }
    if (found === -1) return -1;
    matched++;
    run = found === ti ? run + 1 : 1;
    score += 2 + run; // contiguous runs compound
    if (found === 0 || /\s/.test(t[found - 1])) score += 3; // word-boundary bonus
    ti = found + 1;
  }
  if (matched < q.length) return -1;
  return score;
}

// A labelled chunk of a doc. A card (case brief, statute, recipe) becomes its own
// segment with a name; everything else is one unlabelled segment. A match inside a
// labelled segment surfaces that card's name and just its text.
export interface Segment {
  label: string; // '' for plain content, e.g. "Case brief: Donoghue v Stevenson"
  text: string;
}

/** One searchable thing, a page or a table row, flattened to title + body. */
export interface IndexDoc {
  kind: 'page' | 'row' | 'file' | 'comment';
  id: string; // page id, or row id (openRow takes this)
  title: string;
  body: string; // page text, or the row's cells joined
  segments: Segment[]; // labelled chunks, so a card hit can name the card
  icon: string; // page icon, '' for rows
  context: string; // '' for pages, the table name for rows
  updated: string;
}

// Card node types that get their own named segment in search.
const CARD_LABELS: Record<string, string> = {
  caseBrief: 'Case brief',
  statute: 'Statute',
  recipeCard: 'Recipe',
};

function cardLabel(node: { type?: string; attrs?: Record<string, unknown> }): string {
  const base = CARD_LABELS[node.type ?? ''] ?? 'Card';
  const a = node.attrs ?? {};
  const name = (a.title as string) || (a.act as string) || '';
  return name ? `${base}: ${name}` : base;
}

/** Split a page's content into labelled segments: each card on its own (so a hit
 *  can name it), and all the rest as one plain segment. */
export function pageSegments(content: unknown): Segment[] {
  const cards: Segment[] = [];
  let general = '';
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
    if (n.type && CARD_LABELS[n.type]) {
      cards.push({ label: cardLabel(n), text: attrText(n.attrs ?? {}).replace(/\s+/g, ' ').trim() });
      return; // the card's text is captured; don't also fold it into general
    }
    if (typeof n.text === 'string') general += n.text + ' ';
    if (n.attrs) general += attrText(n.attrs);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  const g = general.replace(/\s+/g, ' ').trim();
  return g ? [{ label: '', text: g }, ...cards] : cards;
}

/** Flatten the in-memory store into a search index. Cheap enough to rebuild on
 *  every data change (the palette memoizes it), so there's no index to keep in
 *  sync, it's always derived from the store. */
export function buildSearchIndex(
  pages: Record<string, Page>,
  tables: Record<string, TableData>,
  rows: Record<string, TableRow>,
  // Decrypted plain text for encrypted page bodies (the store holds the envelope,
  // so it can't be flattened directly). Keyed by page id; empty when none.
  bodyText: Record<string, string> = {},
  // Comments were the last thing search could not see. A decision usually
  // lives in the thread rather than on the page, so "where did we agree
  // that" had no answer. An encrypted body is skipped rather than indexed:
  // an envelope is a string and would only add noise.
  comments: Comment[] = [],
): IndexDoc[] {
  const docs: IndexDoc[] = [];

  for (const p of Object.values(pages)) {
    if (p.trashed) continue;
    if (p.parent === '__shared__') continue; // off-tree shared copies (a shared recipe)
    const segments: Segment[] = isEnvelope(p.content)
      ? [{ label: '', text: bodyText[p.id] ?? '' }]
      : pageSegments(p.content);
    docs.push({
      kind: 'page',
      id: p.id,
      title: p.title || 'Untitled',
      body: segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
      segments,
      icon: p.icon || '',
      context: '',
      updated: p.updated || '',
    });

    // Attachments are searchable too. They were not indexed at all, so a passport
    // scan or a ticket PDF was findable only by remembering which page it was on
    // and opening that tab. Name + where it sits is enough to find it; the hit
    // carries the page id, so opening it lands on the page that holds it.
    for (const f of p.files ?? []) {
      docs.push({
        kind: 'file',
        id: p.id, // the PAGE to open; a file has nowhere of its own to go
        title: f.name || 'File',
        body: `${f.name ?? ''} ${f.mime ?? ''}`.trim(),
        segments: [{ label: 'Files', text: f.name ?? '' }],
        icon: '',
        context: p.title || 'Untitled',
        updated: p.updated || '',
      });
    }
    for (const ph of p.photos ?? []) {
      const name = ph.alt || 'Photo';
      docs.push({
        kind: 'file',
        id: p.id,
        title: name,
        body: `${name} ${ph.album ?? ''}`.trim(),
        segments: [{ label: ph.album ? `Photos / ${ph.album}` : 'Photos', text: name }],
        icon: '',
        context: p.title || 'Untitled',
        updated: p.updated || '',
      });
    }
  }

  for (const r of Object.values(rows)) {
    const table = tables[r.table];
    if (!table) continue;
    const tCol = titleColumn(table.columns);
    const title = (tCol ? cellText(r.cells[tCol.id] ?? null, tCol) : '') || 'Untitled row';
    let body = '';
    for (const col of table.columns) {
      const v = r.cells[col.id];
      if (v == null || v === '') continue;
      const txt = cellText(v, col);
      if (txt) body += txt + ' ';
    }
    const rowBody = body.replace(/\s+/g, ' ').trim();
    docs.push({
      kind: 'row',
      id: r.id,
      title,
      body: rowBody,
      segments: [{ label: '', text: rowBody }],
      icon: '',
      context: table.name || 'Table',
      updated: r.updated || '',
    });
  }

  for (const c of comments) {
    const body: string = typeof c.body === 'string' ? c.body.trim() : '';
    // NOT isEnvelope() here: it is a `value is string` predicate, so the
    // negative branch would narrow an already-string body to never.
    if (!body || body.startsWith('enc:v1:')) continue;
    const page = pages[c.page];
    if (page?.trashed) continue;
    docs.push({
      kind: 'comment',
      // The hit navigates to the PAGE (or row) the comment is on, which is what
      // you want when you find one: the conversation in context, not the comment
      // floating on its own.
      id: c.row || c.page,
      title: body.length > 60 ? `${body.slice(0, 60)}...` : body,
      body,
      segments: [{ label: c.authorName || 'Comment', text: body }],
      icon: '',
      context: page?.title || 'Comment',
      updated: c.updated || c.created || '',
    });
  }

  return docs;
}

export interface SearchHit {
  kind: 'page' | 'row' | 'file' | 'comment';
  id: string;
  title: string;
  icon: string;
  context: string;
  score: number;
  snippet: string;
  // The actual word in the doc that the (possibly fuzzy/typo'd) query matched
  // closest, so the UI can show "you typed lodgign, this is `lodging`". Empty for
  // the resting list or when the query is already an exact prefix of the title.
  match: string;
  // Substrings the UI should highlight in the title and snippet (one per query
  // term: the literal for a *contains* term, the closest word for a fuzzy term).
  highlights: string[];
}

/** The word in `text` that scores highest against the query, or '' if nothing
 *  meaningfully matches. Lets the palette show what a fuzzy query actually hit. */
export function bestMatchWord(query: string, text: string): string {
  const q = query.trim();
  if (!q || !text) return '';
  let best = '';
  let bestScore = 0;
  const seen = new Set<string>();
  for (const w of text.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 2) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const s = fuzzyScore(q, w);
    if (s > bestScore) {
      bestScore = s;
      best = w;
    }
  }
  return best;
}

// One parsed query term. `contains` (from *x*) means x must appear as a literal
// substring; otherwise it's a fuzzy/typo-tolerant match.
interface QueryTerm {
  needle: string;
  contains: boolean;
}

/** Parse a query into AND-ed terms. ';' separates required terms; '*x*' makes a
 *  term a literal "contains x". So `done;water` needs both, `*gmail.com*` matches
 *  any text containing gmail.com, and `*one*;*ter*` needs both substrings. */
export function parseQuery(query: string): QueryTerm[] {
  return query
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^\*(.+)\*$/.exec(part);
      return m ? { needle: m[1].trim(), contains: true } : { needle: part, contains: false };
    })
    .filter((t) => t.needle.length > 0);
}

function termScore(term: QueryTerm, text: string): number {
  if (!text) return -1;
  if (term.contains) return text.toLowerCase().includes(term.needle.toLowerCase()) ? 60 : -1;
  return fuzzyScore(term.needle, text);
}

function highlightFor(term: QueryTerm, hay: string): string {
  if (term.contains) return term.needle;
  if (hay.toLowerCase().includes(term.needle.toLowerCase())) return term.needle;
  return bestMatchWord(term.needle, hay);
}

/** Rank the index against a query. Empty query returns a recent-pages list. Every
 *  AND-ed term must hit (title or body); a hit's context names the card it landed
 *  in and the snippet shows just that part, with the matched text highlighted. */
export function searchIndex(index: IndexDoc[], query: string, limit = 8): SearchHit[] {
  const terms = parseQuery(query);

  if (!terms.length) {
    return index
      .filter((d) => d.kind === 'page')
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, limit)
      .map((d) => ({ kind: d.kind, id: d.id, title: d.title, icon: d.icon, context: d.context, score: 0, snippet: '', match: '', highlights: [] }));
  }

  const hits: SearchHit[] = [];
  for (const d of index) {
    let total = 0;
    let ok = true;
    const highlights: string[] = [];
    let bestSeg: Segment | null = null;
    let bestSegScore = -1;

    for (const term of terms) {
      const titleS = termScore(term, d.title);
      const bodyS = termScore(term, d.body);
      const best = Math.max(titleS >= 0 ? titleS * 3 : -1, bodyS);
      if (best < 0) {
        ok = false;
        break;
      }
      total += best;
      const hl = highlightFor(term, `${d.title} ${d.body}`);
      if (hl) highlights.push(hl);
      for (const seg of d.segments) {
        const s = termScore(term, seg.text);
        if (s > bestSegScore) {
          bestSegScore = s;
          bestSeg = seg;
        }
      }
    }
    if (!ok) continue;

    const seg = bestSeg ?? d.segments[0] ?? { label: '', text: d.body };
    // A typo hint only makes sense for a single fuzzy term.
    const word = terms.length === 1 && !terms[0].contains ? bestMatchWord(terms[0].needle, `${d.title} ${d.body}`) : '';
    const match = word && !query.toLowerCase().includes(word.toLowerCase()) ? word : '';

    hits.push({
      kind: d.kind,
      id: d.id,
      title: d.title,
      icon: d.icon,
      context: seg.label || d.context,
      score: d.kind === 'row' ? total - 1 : total,
      snippet: snippet(seg.text || d.body, highlights),
      match,
      highlights: [...new Set(highlights)],
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** A short excerpt of `text` centred on the first highlight term, if any. */
function snippet(text: string, highlights: string[]): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  let i = -1;
  for (const h of highlights) {
    const at = lower.indexOf(h.toLowerCase());
    if (at !== -1) {
      i = at;
      break;
    }
  }
  if (i === -1) return text.slice(0, 90) + (text.length > 90 ? '…' : '');
  const start = Math.max(0, i - 30);
  return (start > 0 ? '…' : '') + text.slice(start, start + 100).trim() + (text.length > start + 100 ? '…' : '');
}
