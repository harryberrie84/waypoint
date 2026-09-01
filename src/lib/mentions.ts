import type { Member } from './api';

// Pure helpers for @mentions in comment bodies. A mention is the literal text
// "@<member name>" inserted by the composer. We match against the known member
// roster (longest names first, so "@Anna Smith" wins over "@Anna").

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortedByLen(members: Member[]): Member[] {
  return [...members].sort((a, b) => b.name.length - a.name.length);
}

/** User ids whose "@name" appears in the body. */
export function parseMentions(body: string, members: Member[]): string[] {
  const ids = new Set<string>();
  const lower = body.toLowerCase();
  for (const m of members) {
    if (m.name && lower.includes(`@${m.name.toLowerCase()}`)) ids.add(m.id);
  }
  return [...ids];
}

export interface MentionSegment {
  text: string;
  member?: Member; // present when this segment is a mention
}

/** Split a body into plain + mention segments for highlighted rendering. */
export function mentionSegments(body: string, members: Member[]): MentionSegment[] {
  const named = sortedByLen(members.filter((m) => m.name));
  if (named.length === 0) return [{ text: body }];
  const re = new RegExp(`@(${named.map((m) => escapeRe(m.name)).join('|')})`, 'gi');
  const out: MentionSegment[] = [];
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) out.push({ text: body.slice(last, m.index) });
    const member = named.find((mm) => mm.name.toLowerCase() === m![1].toLowerCase());
    out.push({ text: m[0], member });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out.length ? out : [{ text: body }];
}

/** The "@partial" token currently being typed at the cursor, if any. */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  // Must be at start or preceded by whitespace, and contain no whitespace since.
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const frag = upto.slice(at + 1);
  if (/\s/.test(frag)) return null;
  return { query: frag, start: at };
}
