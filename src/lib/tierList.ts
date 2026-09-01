// Pure logic for the tier-list widget: put each item in the tier whose rating
// range contains its score, and sort each tier highest-first (leftmost = best).
// No React/DOM, so it's unit-tested.

export interface TierDef {
  id: string;
  label: string; // "S", "A", ...
  color: string; // hex
  min: number; // inclusive rating bounds (order-agnostic)
  max: number;
}

export interface TierItem {
  id: string;
  text: string;
  image: string; // uploaded file url (inline data URL only as a fallback), '' for none
  rating: number | null; // null = not scored yet (lives in the Unranked pool)
}

export interface TierRow {
  tier: TierDef | null; // null = the trailing "unranked" bucket
  items: TierItem[];
}

/** The full tier-list state, shared by the /tier-list widget (in node attrs) and
 *  the page-level Tier list tab (in pages.tierlist). */
export interface TierListData {
  title: string;
  mode: 'tiers' | 'table';
  tiers: TierDef[];
  items: TierItem[];
}

export function defaultTierList(): TierListData {
  return { title: '', mode: 'tiers', tiers: defaultTiers(), items: [] };
}

/** A friendly starter palette + eight tiers-worth of colours for new tiers. */
export const TIER_PALETTE = ['#e05a86', '#e6595b', '#e59a52', '#e6cb57', '#7fc26b', '#5aa9e6', '#9b7fe6', '#8a94a6'];

/** Five starter tiers (S..D) spanning 0..100, with stable ids. */
export function defaultTiers(): TierDef[] {
  return [
    { id: 't-s', label: 'S', color: '#e05a86', min: 90, max: 100 },
    { id: 't-a', label: 'A', color: '#e6595b', min: 75, max: 89 },
    { id: 't-b', label: 'B', color: '#e59a52', min: 60, max: 74 },
    { id: 't-c', label: 'C', color: '#e6cb57', min: 40, max: 59 },
    { id: 't-d', label: 'D', color: '#7fc26b', min: 0, max: 39 },
  ];
}

/** The first tier whose inclusive [min,max] contains the rating (bounds may be
 *  given in either order). A null rating is in no tier (unranked). */
export function tierForRating(tiers: TierDef[], rating: number | null): TierDef | undefined {
  if (rating === null) return undefined;
  return tiers.find((t) => rating >= Math.min(t.min, t.max) && rating <= Math.max(t.min, t.max));
}

/** Items grouped into the given tiers (tier order preserved), each tier's items
 *  sorted by rating descending (highest first). Items with no matching tier fall
 *  into a trailing null "unranked" pool (kept in input order). The pool row is
 *  included when it has items, or always when `includeEmptyPool` (so the editor
 *  has a drop target and a place to add items). */
export function buildTierRows(tiers: TierDef[], items: TierItem[], includeEmptyPool = false): TierRow[] {
  const byTier = new Map<string, TierItem[]>();
  const pool: TierItem[] = [];
  for (const it of items) {
    const t = tierForRating(tiers, it.rating);
    if (t) {
      const arr = byTier.get(t.id) ?? [];
      arr.push(it);
      byTier.set(t.id, arr);
    } else {
      pool.push(it);
    }
  }
  const sortDesc = (arr: TierItem[]) => arr.slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const rows: TierRow[] = tiers.map((t) => ({ tier: t, items: sortDesc(byTier.get(t.id) ?? []) }));
  if (pool.length || includeEmptyPool) rows.push({ tier: null, items: pool });
  return rows;
}

/** A rating that lands an item in `tier` at position `insertIndex` among that
 *  tier's already-sorted (highest-first) items, so dragging into a tier keeps the
 *  left-to-right order. Stays within the tier's range. */
export function ratingForInsert(tier: TierDef, sorted: TierItem[], insertIndex: number): number {
  const lo = Math.min(tier.min, tier.max);
  const hi = Math.max(tier.min, tier.max);
  const above = insertIndex > 0 ? sorted[insertIndex - 1]?.rating ?? hi : hi; // higher-rated left neighbour
  const below = insertIndex < sorted.length ? sorted[insertIndex]?.rating ?? lo : lo; // lower-rated right neighbour
  const mid = (Math.min(above, hi) + Math.max(below, lo)) / 2;
  return Math.min(hi, Math.max(lo, mid));
}
