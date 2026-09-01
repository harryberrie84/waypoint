// Compact client-side id generator used only for things PocketBase doesn't
// assign ids to: column ids and select-option ids living inside JSON fields.
// Record ids (pages, tables, rows, comments) come from PocketBase itself.
export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}${time}${rand}`;
}

/** Human-readable short id shown in relational reference chips. */
export function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
}

// Tag/select colours. Saturated mid-tones that all read with white chip text and
// hold up on both light and dark page backgrounds, so they stay legible whatever
// the active theme is. The picker (in the select cell) lets each option choose any
// of these, so colours are per-option and not tied to one theme's accent.
export const TAG_COLORS = [
  '#c0455e', // rose
  '#d4663a', // orange
  '#c0892e', // amber
  '#5a9e4f', // green
  '#3a9e95', // teal
  '#3a82c4', // blue
  '#5a5fd0', // indigo
  '#8c52c4', // purple
  '#b84a93', // magenta
  '#b5563a', // clay
  '#be3b34', // red
  '#2c8c6f', // emerald
  '#9c6b2f', // bronze
  '#64748b', // slate
];

export function pickTagColor(index: number): string {
  return TAG_COLORS[index % TAG_COLORS.length];
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
