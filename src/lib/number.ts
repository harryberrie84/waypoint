import type { NumberStyle } from '../types';

// Sweden (and much of Europe) writes the decimal mark as a comma, while a lot of
// data and habits use a dot, in the default 'swedish' style "12,50" and "12.50"
// mean the same thing: the LAST comma/dot is the decimal, anything before it is a
// thousands separator and gets stripped. Spaces (incl. the non-breaking kind
// Sweden groups thousands with) are dropped too.
//
//   "12,50"      -> 12.5      "12.50"      -> 12.5
//   "1 234,50"   -> 1234.5    "1,234.50"   -> 1234.5
//   "1.000"      -> 1         "1000"       -> 1000
//
// In 'standard' style the dot is the decimal and the comma is a thousands
// separator, so "1,234.50" -> 1234.5 and "12,50" -> 1250.
export function parseLocaleNumber(raw: string | number | null | undefined, style: NumberStyle = 'swedish'): number {
  if (typeof raw === 'number') return raw;
  if (raw == null) return NaN;
  const s = String(raw).trim().replace(/\s/g, ''); // \s covers the non-breaking space too
  if (!s) return NaN;
  if (style === 'standard') return Number(s.replace(/,/g, '')); // comma = thousands
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep === -1) return Number(s);
  const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
  const fracPart = s.slice(lastSep + 1).replace(/[.,]/g, '');
  return Number(`${intPart}.${fracPart}`);
}

// Is this string a number once the workspace's decimal style is taken into account?
export function isLocaleNumber(raw: string, style: NumberStyle = 'swedish'): boolean {
  return raw.trim() !== '' && Number.isFinite(parseLocaleNumber(raw, style));
}
