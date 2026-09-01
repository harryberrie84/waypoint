// ---------------------------------------------------------------------------
// Places, keyless OpenStreetMap search plus outbound review links. No API key,
// no backend: Nominatim is queried straight from the browser, which sends our
// origin as the Referer so the app identifies itself per OSM's usage policy.
// Results carry coordinates, address and category only. OSM has no review score,
// so we never read or invent a rating, for reviews we link out instead. Tabelog
// (Japan) and Google Maps both take a plain search URL and pull nothing back.
// ---------------------------------------------------------------------------

export interface PlaceResult {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string; // human-readable, from Nominatim's display_name
  city?: string; // best city/town/village from the address parts, for Tabelog
  category?: string; // OSM type, e.g. 'restaurant', 'city', never a rating
  // POI extras from Nominatim's `extratags` (only present when requested + tagged
  // in OSM). No review score exists in OSM; `stars` is a hotel star class, not a
  // rating.
  cuisine?: string;
  openingHours?: string;
  website?: string;
  phone?: string;
  stars?: number;
  source: 'osm';
}

// --- Outbound deep links ----------------------------------------------------

// Tabelog has no API and must not be scraped. We land the user on its search
// results for "<name> <city>"; that's a results page, not a guaranteed match.
export function tabelogSearchUrl(name: string, city?: string): string {
  const q = [name, city].filter(Boolean).join(' ').trim();
  return `https://tabelog.com/en/rstLst/?sw=${encodeURIComponent(q)}`;
}

// A plain Google Maps search by name + coordinates. Deep link only: no key, and
// it pulls no data back into the app.
export function googleMapsUrl(name: string, lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat},${lon}`)}`;
}

// --- Nominatim search -------------------------------------------------------

interface NominatimRow {
  place_id?: number | string;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
}

// The populated place sits under different keys depending on the country, so we
// fall through city → town → village → … to fill the Tabelog city.
function cityOf(addr: Record<string, string> | undefined): string | undefined {
  if (!addr) return undefined;
  return addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state || undefined;
}

// Pull the handful of POI tags we surface out of Nominatim's `extratags`. OSM
// tagging is messy: contact info lives under either `phone`/`website` or the
// `contact:*` namespace, so we check both. We never read a review score (none
// exists); `stars` is the hotel star-class tag, parsed only when numeric.
function poiTagsOf(tags: Record<string, string> | null | undefined): Pick<PlaceResult, 'cuisine' | 'openingHours' | 'website' | 'phone' | 'stars'> {
  const t = tags ?? {};
  const stars = Number(t.stars);
  return {
    cuisine: t.cuisine || undefined,
    openingHours: t.opening_hours || undefined,
    website: t.website || t['contact:website'] || undefined,
    phone: t.phone || t['contact:phone'] || undefined,
    stars: Number.isFinite(stars) && stars > 0 ? stars : undefined,
  };
}

// Map a Nominatim jsonv2 payload to PlaceResult[]. Pure, and deliberately reads
// no rating (OSM has none). Rows without usable coordinates are dropped.
export function normalizeNominatim(json: unknown): PlaceResult[] {
  if (!Array.isArray(json)) return [];
  const out: PlaceResult[] = [];
  for (const raw of json as NominatimRow[]) {
    const lat = Number(raw?.lat);
    const lon = Number(raw?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const display = raw.display_name ?? '';
    out.push({
      id: String(raw.place_id ?? `${lat},${lon}`),
      name: raw.name || display.split(',')[0] || 'Unknown place',
      lat,
      lon,
      address: display || undefined,
      city: cityOf(raw.address),
      category: raw.type || raw.category || undefined,
      ...poiTagsOf(raw.extratags),
      source: 'osm',
    });
  }
  return out;
}

// --- Cache + rate limit -----------------------------------------------------
// Nominatim asks for at most ~1 request/second and no bulk hammering. We cache
// every query (in memory, plus a short-TTL localStorage echo so a reload doesn't
// re-fetch) and space real network calls at least a second apart.

const CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_INTERVAL_MS = 1100;
const mem = new Map<string, { at: number; results: PlaceResult[] }>();
let lastFetchAt = 0;

// A rectangle to bias toward (or, when `bounded`, to restrict results to).
export interface ViewBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface SearchOpts {
  viewbox?: ViewBox; // exact box to bias/limit by; overrides the ~1° box around `near`
  bounded?: boolean; // hard-limit results to the viewbox (Nominatim bounded=1)
}

function cacheKey(query: string, near?: { lat: number; lon: number }, opts?: SearchOpts): string {
  const n = near ? `@${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : '';
  // A bounded search is a different query than an open one, so key them apart.
  const b =
    opts?.bounded && opts.viewbox
      ? `!b${[opts.viewbox.south, opts.viewbox.west, opts.viewbox.north, opts.viewbox.east].map((x) => x.toFixed(2)).join(',')}`
      : '';
  return `waypoint:places:${query.trim().toLowerCase()}${n}${b}`;
}

function readCache(key: string): PlaceResult[] | null {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { at: number; results: PlaceResult[] };
      if (Date.now() - parsed.at < CACHE_TTL_MS) {
        mem.set(key, parsed);
        return parsed.results;
      }
    }
  } catch {
    // private-mode or malformed cache, treat as a miss.
  }
  return null;
}

function writeCache(key: string, results: PlaceResult[]): void {
  const entry = { at: Date.now(), results };
  mem.set(key, entry);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // storage full or unavailable, the in-memory cache still covers the session.
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Search OSM for a place, biased toward `near` (the current map view) when given.
// Returns [] on any failure, a missing or rate-limited server never throws into
// the UI.
export async function searchPlaces(query: string, near?: { lat: number; lon: number }, opts?: SearchOpts): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = cacheKey(q, near, opts);
  const cached = readCache(key);
  if (cached) return cached;

  const gap = Date.now() - lastFetchAt;
  if (gap < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - gap);
  lastFetchAt = Date.now();

  const params = new URLSearchParams({ format: 'jsonv2', q, limit: '10', addressdetails: '1', extratags: '1', namedetails: '1' });
  // viewbox is lon,lat,lon,lat (two opposite corners).
  if (opts?.viewbox) {
    const v = opts.viewbox;
    params.set('viewbox', `${v.west},${v.north},${v.east},${v.south}`);
    // bounded=1 restricts results to the box, i.e. "only this map area".
    if (opts.bounded) params.set('bounded', '1');
  } else if (near) {
    // A ~1° box around the point, left unbounded so far-away matches still come
    // through when the local area has none.
    const d = 1;
    params.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
  }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const results = normalizeNominatim(await r.json());
    writeCache(key, results);
    return results;
  } catch {
    return [];
  }
}
