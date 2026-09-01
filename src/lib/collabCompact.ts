// Pure compaction arithmetic for the Yjs relay, split out from lib/collab.ts (which
// pulls in PocketBase and the stores) so the guard rail is unit-testable on its own.

/** How many of the oldest relay rows to prune: everything beyond the kept tail,
 *  capped per run so a large backlog drains over several runs rather than in one
 *  storm of deletes. Never negative. */
export function compactCount(total: number, keep: number, maxPerRun: number): number {
  if (total <= keep) return 0;
  return Math.min(total - keep, maxPerRun);
}
