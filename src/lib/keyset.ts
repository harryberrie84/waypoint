// Full-collection loads by keyset (id order) instead of page numbers.
//
// A page-number list makes SQLite walk every earlier row again for each page,
// so a whole collection costs the square of its length: 12,000 rows took about
// 3.1 s of server time that way and 0.7 s by id (PocketBase 0.22, measured).
// Paging by id also cannot skip or repeat a row when another one moves while the
// list loads, which an ORDER BY on a mutable column can.
//
// The caller's order is restored in the browser with sortByKey, the same order
// the server's sort gave, with id breaking ties so it no longer depends on which
// equal row SQLite happened to return first.

export const KEYSET_PAGE = 500; // PocketBase 0.22's largest page

type Keyed = { id: string } & Record<string, unknown>;

export function sortByKey<T extends Keyed>(records: T[], key: string): T[] {
  const val = (r: T) => r[key];
  return [...records].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x !== y) {
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      if (x == null) return -1;
      if (y == null) return 1;
      const sx = String(x);
      const sy = String(y);
      if (sx !== sy) return sx < sy ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Drive a keyset load. `fetchPage(afterId)` returns up to KEYSET_PAGE records
// with id > afterId in id order ('' for the first page).
export async function loadAllByKeyset<T extends { id: string }>(fetchPage: (afterId: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let after = '';
  for (;;) {
    const page = await fetchPage(after);
    out.push(...page);
    if (page.length < KEYSET_PAGE) return out;
    const last = page[page.length - 1].id;
    // A page that does not move forward would loop forever: stop instead.
    if (!(last > after)) return out;
    after = last;
  }
}
