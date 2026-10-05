// Order slash-menu matches so the command you named comes first. The menu used to
// keep the list's own order and only filter it, so "/embed" offered Synced page
// (whose keywords mention embedding) above Embed, and "/formula" offered Math
// above Formula. Within a rank the list's own order stands.
export interface Rankable {
  title: string;
  keywords: string[];
}

function rank(item: Rankable, q: string): number {
  const title = item.title.toLowerCase();
  const keywords = item.keywords.map((k) => k.toLowerCase());
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (keywords.includes(q)) return 2;
  if (title.split(/[\s/-]+/).some((w) => w.startsWith(q))) return 3;
  if (title.includes(q)) return 4;
  if (keywords.some((k) => k.startsWith(q))) return 5;
  if (keywords.some((k) => k.includes(q))) return 6;
  return -1;
}

/** The items matching `query`, best match first. */
export function rankCommands<T extends Rankable>(items: T[], query: string): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return items;
  return items
    .map((item, i) => ({ item, i, r: rank(item, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}
