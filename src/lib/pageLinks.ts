import type { Page } from '../types';
import { isEnvelope } from './crypto';

// Page-to-page links: a `pageLink` block or a `pageRef` inline reference ([[...]]),
// both carrying attrs.pageId, sitting in the page body. extractPageLinks walks a
// decrypted doc for them; buildLinkGraph turns the workspace into an adjacency map,
// reading plaintext bodies directly and encrypted ones from a precomputed list (the
// store decrypts those for search, so we never re-read ciphertext here). Pure.

export function extractPageLinks(doc: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if ((n.type === 'pageLink' || n.type === 'pageRef') && n.attrs) {
      const id = n.attrs.pageId;
      if (typeof id === 'string' && id) out.add(id);
    }
    if (Array.isArray(n.content)) for (const c of n.content) walk(c);
  };
  walk(doc);
  return [...out];
}

// pageId -> the live, non-trashed pages it links to (deduped, self-link dropped).
export function buildLinkGraph(pages: Record<string, Page>, encLinks: Record<string, string[]>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const p of Object.values(pages)) {
    if (p.trashed) continue;
    const raw = isEnvelope(p.content) ? (encLinks[p.id] ?? []) : extractPageLinks(p.content);
    const seen = new Set<string>();
    const valid: string[] = [];
    for (const t of raw) {
      if (!t || t === p.id || seen.has(t)) continue;
      const target = pages[t];
      if (!target || target.trashed) continue;
      seen.add(t);
      valid.push(t);
    }
    adj.set(p.id, valid);
  }
  return adj;
}

export function outboundOf(adj: Map<string, string[]>, pageId: string): string[] {
  return adj.get(pageId) ?? [];
}

export function backlinksOf(adj: Map<string, string[]>, pageId: string): string[] {
  const out: string[] = [];
  for (const [from, tos] of adj) if (from !== pageId && tos.includes(pageId)) out.push(from);
  return out;
}
