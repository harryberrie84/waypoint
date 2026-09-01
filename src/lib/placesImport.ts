// ---------------------------------------------------------------------------
// placesImport, parse a pasted/uploaded block of places into pins for the map.
// Forgiving by design so people can paste from a spreadsheet, a notes app, or
// Google Maps without reformatting. Pure and total (never throws); the map just
// takes the coordinates it can read and reports how many lines it couldn't.
// ---------------------------------------------------------------------------

import { parseGoogleMapsUrl } from './urlImport';

export interface ImportedPlace {
  name: string;
  lat: number;
  lon: number;
}

// The worked example shown in the map's Import box (and its "Paste example"
// button): one place per accepted form, name+coords, bare coords, and a Google
// Maps link. Lives here so a test can prove it still parses (all 3 lines).
export const MAP_IMPORT_EXAMPLE =
  'Tsuta Ramen, 35.7300, 139.7101\nBlue Bottle Shibuya, 35.6597, 139.6996\n35.6586, 139.7454\nhttps://www.google.com/maps?q=35.6764,139.6500';

export interface PlacesImportResult {
  places: ImportedPlace[];
  skipped: number; // non-empty lines we couldn't read, for an honest count
}

const validLat = (n: number) => Number.isFinite(n) && Math.abs(n) <= 90;
const validLon = (n: number) => Number.isFinite(n) && Math.abs(n) <= 180;
const coordName = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

// One place per line. Accepts:
//   Name, latitude, longitude      (comma or tab; the name may contain commas)
//   latitude, longitude            (name defaults to the coordinate)
//   Name latitude longitude        (space separated)
//   a Google Maps URL              (coords + name pulled from the link)
// Blank lines and lines starting with '#' are ignored.
export function parsePlacesImport(text: string): PlacesImportResult {
  const places: ImportedPlace[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^https?:\/\//i.test(line)) {
      const g = parseGoogleMapsUrl(line);
      if (g && g.lat != null && g.lon != null && validLat(g.lat) && validLon(g.lon)) {
        places.push({ name: (g.name ?? '').trim() || coordName(g.lat, g.lon), lat: g.lat, lon: g.lon });
      } else {
        skipped++;
      }
      continue;
    }

    const parsed = parseLine(line);
    if (parsed) places.push(parsed);
    else skipped++;
  }
  return { places, skipped };
}

function parseLine(line: string): ImportedPlace | null {
  // Column form first: the last two non-empty columns are lat, lon; everything
  // before them is the name (so "Joe's, Diner, 35.6, 139.7" keeps its comma).
  const cols = line.split(/[\t,]/).map((s) => s.trim());
  if (cols.length >= 2) {
    const lon = Number(cols[cols.length - 1]);
    const lat = Number(cols[cols.length - 2]);
    if (cols[cols.length - 1] !== '' && cols[cols.length - 2] !== '' && validLat(lat) && validLon(lon)) {
      const name = cols.slice(0, cols.length - 2).join(', ').trim();
      return { name: name || coordName(lat, lon), lat, lon };
    }
  }
  // Space-separated fallback: an optional name then the two trailing numbers.
  const m = /^(?:(.*?)[\s,]+)?(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/.exec(line);
  if (m) {
    const lat = Number(m[2]);
    const lon = Number(m[3]);
    if (validLat(lat) && validLon(lon)) return { name: (m[1] ?? '').trim() || coordName(lat, lon), lat, lon };
  }
  return null;
}
