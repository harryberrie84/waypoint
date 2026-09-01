// Labeled links inside a plain-string cell, stored as markdown: [label](href).
// Keeping it a string means the value rides the existing optimistic text path,
// CSV, and PocketBase JSON unchanged, no new cell shape to thread through sort,
// search, formulas, or the schema. parseCellLink only matches a value that is
// *exactly* one link, so ordinary text that happens to contain brackets isn't
// hijacked into a link.

export interface CellLink {
  label: string;
  href: string;
}

const LINK_RE = /^\s*\[([^\]]+)\]\(\s*(\S+?)\s*\)\s*$/;

export function parseCellLink(value: unknown): CellLink | null {
  if (typeof value !== 'string') return null;
  const m = value.match(LINK_RE);
  if (!m) return null;
  const label = m[1].trim();
  const href = m[2].trim();
  return label && href ? { label, href } : null;
}

// Bare hosts (booking.com/x) get https:// so the anchor actually navigates;
// mailto:/http(s):/ are left alone.
export function linkHref(href: string): string {
  return /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
}

export function formatCellLink(label: string, href: string): string {
  const h = href.trim();
  return `[${label.trim() || h}](${h})`;
}

// The visible text of a cell: a link's label, otherwise the raw string. Used by
// the renderer and by cellText so sort/search/group work on what you see.
export function cellLinkLabel(value: unknown): string {
  const link = parseCellLink(value);
  if (link) return link.label;
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
