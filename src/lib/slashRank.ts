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

/** The items matching `query`, best match first. Within matches equally good,
 *  the ones picked most often here come first (`usage`, picks per title), then
 *  the list's own order. An exact name still always wins. */
export function rankCommands<T extends Rankable>(items: T[], query: string, usage: Record<string, number> = {}): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return items;
  return items
    .map((item, i) => ({ item, i, r: rank(item, q), u: usage[item.title] ?? 0 }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || b.u - a.u || a.i - b.i)
    .map((x) => x.item);
}

// Picks are counted on this device only (they say nothing worth syncing, and
// they never leave the browser).
const USAGE_KEY = 'waypoint:slashUsage';

export function readSlashUsage(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function noteSlashPick(title: string): void {
  try {
    const usage = readSlashUsage();
    usage[title] = (usage[title] ?? 0) + 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* storage unavailable: ranking just falls back to the list order */
  }
}
