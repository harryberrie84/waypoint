// ---------------------------------------------------------------------------
// reactions, pure emoji-vote logic for table rows. A row's reactions are an
// emoji → user-id[] map ("which izakaya?" → 👍 from three people). No React, no
// store: toggling and counting are plain functions so they're trivially tested
// and the store/UI share one source of truth.
// ---------------------------------------------------------------------------

export type ReactionMap = Record<string, string[]>;

// A small travel/food-flavoured palette offered in the picker. Any emoji can end
// up stored (older data, other clients), these are just the quick picks.
export const REACTION_PALETTE = ['👍', '❤️', '😋', '🍜', '🔥', '✅', '❓', '👎'];

function clone(map: ReactionMap | null | undefined): ReactionMap {
  const out: ReactionMap = {};
  for (const [emoji, ids] of Object.entries(map ?? {})) out[emoji] = [...ids];
  return out;
}

// Add or remove `userId`'s vote for `emoji`. Emoji whose last voter leaves are
// dropped so the map never accumulates empty buckets.
export function toggleReaction(map: ReactionMap | null | undefined, emoji: string, userId: string): ReactionMap {
  const next = clone(map);
  const ids = next[emoji] ?? [];
  if (ids.includes(userId)) {
    const left = ids.filter((id) => id !== userId);
    if (left.length) next[emoji] = left;
    else delete next[emoji];
  } else {
    next[emoji] = [...ids, userId];
  }
  return next;
}

export function hasReacted(map: ReactionMap | null | undefined, emoji: string, userId: string): boolean {
  return (map?.[emoji] ?? []).includes(userId);
}

export interface ReactionEntry {
  emoji: string;
  ids: string[];
  count: number;
}

// Non-empty reactions, most-voted first (emoji as a stable tiebreak), for chips.
export function reactionEntries(map: ReactionMap | null | undefined): ReactionEntry[] {
  return Object.entries(map ?? {})
    .filter(([, ids]) => ids.length > 0)
    .map(([emoji, ids]) => ({ emoji, ids, count: ids.length }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function totalReactions(map: ReactionMap | null | undefined): number {
  return Object.values(map ?? {}).reduce((n, ids) => n + ids.length, 0);
}
