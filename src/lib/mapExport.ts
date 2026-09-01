// ---------------------------------------------------------------------------
// mapExport, turn a page map's places into portable JSON / CSV, and a compact
// text line for "copy this place". Pure (data in, string out), so it's testable
// and shared by the export menu, the per-pin copy button, and the public share.
// ---------------------------------------------------------------------------

export interface MapPlace {
  name: string;
  lat: number;
  lon: number;
  address?: string;
  category?: string;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** A places list as CSV with a header row (Name, Latitude, Longitude, ...). */
export function placesToCsv(places: MapPlace[]): string {
  const header = ['Name', 'Latitude', 'Longitude', 'Address', 'Category'];
  const rows = places.map((p) =>
    [p.name, p.lat, p.lon, p.address ?? '', p.category ?? ''].map((v) => csvCell(String(v))).join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

/** A places list as pretty JSON, tagged so it round-trips through the importer. */
export function placesToJson(places: MapPlace[], title = 'Map'): string {
  return JSON.stringify({ waypointMap: 1, title, places }, null, 2);
}

function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A places list as GPX 1.1 waypoints, so the pins import into Google Earth,
 *  Garmin, hiking apps, and the like. Address + category ride in <desc>. */
export function placesToGpx(places: MapPlace[], title = 'Map'): string {
  const wpts = places
    .map((p) => {
      const desc = [p.address, p.category].filter(Boolean).join(' · ');
      const lines = [`  <wpt lat="${p.lat}" lon="${p.lon}">`, `    <name>${xmlEscape(p.name || 'Pin')}</name>`];
      if (desc) lines.push(`    <desc>${xmlEscape(desc)}</desc>`);
      lines.push('  </wpt>');
      return lines.join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Waypoint" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata><name>${xmlEscape(title)}</name></metadata>`,
    wpts,
    '</gpx>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The one-line clipboard text for a single place: "Name · lat, lon" plus the
 *  address when there is one. Trims to what actually exists. */
export function placeClipboardText(p: MapPlace): string {
  const coords = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
  const parts = [p.name && p.name.trim(), coords, p.address && p.address.trim()].filter(Boolean);
  return parts.join(' · ');
}
