// Recognise a couple of paste shapes beyond a URL: a bare "lat,long" coordinate,
// and a parcel tracking number or ISBN. Pure and dependency-free so it's testable;
// the editor decides what node/link to insert.

export function parseLatLong(text: string): { lat: number; lon: number } | null {
  // Require decimal points so a Swedish "1,2" (a decimal) isn't read as coords.
  const m = /^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// A labelled chip = a short label plus a link to look it up. Conservative: only
// the distinctive shapes (a UPS 1Z number, an ISBN-13) so plain numbers are left
// alone.
export function trackingChip(text: string): { label: string; href: string } | null {
  const t = text.trim();
  if (/^1Z[0-9A-Z]{16}$/i.test(t)) {
    return { label: `📦 ${t}`, href: `https://www.ups.com/track?loc=en_US&tracknum=${t.toUpperCase()}` };
  }
  const isbn = t.replace(/[-\s]/g, '');
  if (/^(?:978|979)\d{10}$/.test(isbn)) {
    return { label: `📚 ${t}`, href: `https://openlibrary.org/isbn/${isbn}` };
  }
  return null;
}
