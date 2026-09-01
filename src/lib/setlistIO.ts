// ---------------------------------------------------------------------------
// setlistIO, text <-> setlist for import / export (like the recipe widget).
// ---------------------------------------------------------------------------
// A plain, hand-writable line format so a setlist round-trips through a file or
// the clipboard and a blank template can be filled in offline:
//
//   # My set name
//
//   say | welcome everyone | 1
//   segment | intro quiz | 5
//   song | Opening number | who leads | 4
//
// One line per item: `kind | ...`. A song is `song | title | who/key | minutes`;
// a say or a segment is `say | text | minutes` / `segment | text | minutes`
// (no "who/key" column). Minutes are optional and always last. Any line with no
// `|` (or a leading #) is taken as the set title. Pure: no React, no DOM.

export type SetKind = 'song' | 'banter' | 'segment';
export interface SetItem {
  id: string;
  kind: SetKind;
  text: string;
  sub?: string; // song only: artist / key / who leads
  mins?: number;
}

const KIND_IN: Record<string, SetKind> = { song: 'song', say: 'banter', banter: 'banter', segment: 'segment' };
const kindOut = (k: SetKind): string => (k === 'banter' ? 'say' : k);

function numOrUndef(s: string | undefined): number | undefined {
  const t = (s ?? '').trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function serializeSetlist(title: string, items: SetItem[]): string {
  const out: string[] = [];
  if (title.trim()) out.push(`# ${title.trim()}`, '');
  for (const it of items) {
    const m = typeof it.mins === 'number' ? String(it.mins) : '';
    if (it.kind === 'song') out.push(`song | ${it.text} | ${it.sub ?? ''} | ${m}`.trimEnd());
    else out.push(`${kindOut(it.kind)} | ${it.text} | ${m}`.trimEnd());
  }
  return out.join('\n') + '\n';
}

export function parseSetlist(text: string): { title: string; items: SetItem[] } {
  const result: { title: string; items: SetItem[] } = { title: '', items: [] };
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (!result.title) result.title = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    if (!line.includes('|')) {
      if (!result.title) result.title = line;
      continue;
    }
    const parts = line.split('|').map((s) => s.trim());
    const kind = KIND_IN[parts[0].toLowerCase()];
    if (!kind) continue;
    const item: SetItem = { id: `i${n++}`, kind, text: parts[1] ?? '' };
    if (kind === 'song') {
      if (parts[2]) item.sub = parts[2];
      item.mins = numOrUndef(parts[3]);
    } else {
      item.mins = numOrUndef(parts[2]);
    }
    if (item.mins === undefined) delete item.mins;
    result.items.push(item);
  }
  return result;
}

// A blank, fill-in template that re-imports cleanly through parseSetlist.
export const SETLIST_TEMPLATE = `# My set name

say | welcome everyone, thanks for coming | 1
segment | intro quiz | 5
song | First song | who leads | 4
say | quick story before this one | 1
song | Second song |  | 3
segment | thanks, last one | 1
song | Closer | big finish | 4
`;
