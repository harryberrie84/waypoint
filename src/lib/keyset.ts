export const KEYSET_PAGE = 500;

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

export async function loadAllByKeyset<T extends { id: string }>(fetchPage: (afterId: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let after = '';
  for (;;) {
    const page = await fetchPage(after);
    out.push(...page);
    if (page.length < KEYSET_PAGE) return out;
    const last = page[page.length - 1].id;
    if (!(last > after)) return out;
    after = last;
  }
}
