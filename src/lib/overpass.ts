// ---------------------------------------------------------------------------
// Overpass, "what's around here" search for the map. Nominatim (places.ts) is a
// text geocoder, good for "find Kyoto Station"; it can't list every restaurant
// in the box you're looking at. Overpass can: it queries OSM by tag inside a
// bounding box. Keyless, browser-direct (Overpass sends permissive CORS), and
// returns the same PlaceResult shape the map pins + PlaceCard already speak, so
// nothing downstream changes. No review score exists in OSM, so we never invent
// one; the pin still links out to Tabelog / Google Maps for ratings.
// ---------------------------------------------------------------------------

import type { PlaceResult } from './places';

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

// A category the "find nearby" bar offers: a label + the OSM tag filters that
// define it. Several filters are OR-ed (bars OR pubs). Kept small and practical,
// the things you actually look for in an area you're standing in.
export interface AreaCategory {
  key: string;
  label: string;
  filters: [string, string][];
}

// Filters are OR-ed and cast a wide net on purpose: OSM tags the same kind of
// place several ways (a diner might be amenity=restaurant OR food_court; a
// cafe might be amenity=cafe OR shop=coffee), so a category lists every tag it
// reasonably maps to. It still can't surface a place nobody added to OSM, use
// the map's "Import places" or drop a pin by hand for those.
export const AREA_CATEGORIES: AreaCategory[] = [
  { key: 'restaurant', label: 'Restaurants', filters: [['amenity', 'restaurant'], ['amenity', 'food_court']] },
  { key: 'cafe', label: 'Cafés', filters: [['amenity', 'cafe'], ['shop', 'coffee'], ['amenity', 'ice_cream']] },
  { key: 'bar', label: 'Bars & pubs', filters: [['amenity', 'bar'], ['amenity', 'pub'], ['amenity', 'biergarten']] },
  { key: 'fast_food', label: 'Fast food', filters: [['amenity', 'fast_food']] },
  { key: 'hotel', label: 'Stays', filters: [['tourism', 'hotel'], ['tourism', 'hostel'], ['tourism', 'guest_house'], ['tourism', 'motel']] },
  { key: 'sight', label: 'Sights', filters: [['tourism', 'attraction'], ['tourism', 'museum'], ['tourism', 'viewpoint'], ['tourism', 'gallery'], ['tourism', 'artwork']] },
  { key: 'shop', label: 'Shops', filters: [['shop', 'supermarket'], ['shop', 'convenience'], ['shop', 'mall'], ['shop', 'bakery']] },
];

// Cap how much ground one search may cover. Overpass over a whole country of
// restaurants is slow and rude; a viewport this size is roughly city-district
// scale, which is what "the area you're viewing" means in practice.
export const MAX_SPAN_DEG = 0.7;
const MAX_RESULTS = 80;

export function bboxTooBig(b: Bounds): boolean {
  return Math.abs(b.north - b.south) > MAX_SPAN_DEG || Math.abs(b.east - b.west) > MAX_SPAN_DEG;
}

// Build the Overpass QL for one category inside a bbox. `out center` gives ways
// and relations a single lat/lon so a whole building footprint still drops one
// pin. Pure, so it's unit-tested without the network.
export function buildOverpassQuery(cat: AreaCategory, b: Bounds): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const clauses = cat.filters
    .flatMap(([k, v]) => [`node["${k}"="${v}"](${bbox});`, `way["${k}"="${v}"](${bbox});`])
    .join('');
  return `[out:json][timeout:25];(${clauses});out center ${MAX_RESULTS};`;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

function addressOf(t: Record<string, string>): string | undefined {
  const line = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const city = t['addr:city'] || t['addr:town'] || t['addr:suburb'] || '';
  const full = [line, city].filter(Boolean).join(', ');
  return full || undefined;
}

// Map an Overpass payload to PlaceResult[]. Drops unnamed POIs (a nameless pin
// helps no one) and de-dupes by name+rounded-coords (a place tagged as both a
// node and a way shows up twice otherwise). Pure and total, [] on junk input.
export function normalizeOverpass(json: unknown): PlaceResult[] {
  const els =
    json && typeof json === 'object' && Array.isArray((json as { elements?: unknown }).elements)
      ? ((json as { elements: OverpassElement[] }).elements)
      : [];
  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const el of els) {
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const tags = el.tags ?? {};
    const name = tags.name || tags['name:en'] || tags.brand || '';
    if (!name) continue;
    const dedupe = `${name.toLowerCase()}@${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      id: `${el.type ?? 'n'}${el.id ?? `${lat},${lon}`}`,
      name,
      lat,
      lon,
      address: addressOf(tags),
      category: tags.amenity || tags.tourism || tags.shop || undefined,
      cuisine: tags.cuisine || undefined,
      openingHours: tags.opening_hours || undefined,
      website: tags.website || tags['contact:website'] || undefined,
      phone: tags.phone || tags['contact:phone'] || undefined,
      source: 'osm',
    });
  }
  return out;
}

// --- Network (cache + rate limit) ------------------------------------------
// Overpass is a shared free service; space calls out and cache the answer so
// panning back and forth doesn't re-hammer it. Same shape as places.ts.

const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 1500;
const mem = new Map<string, { at: number; results: PlaceResult[] }>();
let lastFetchAt = 0;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Rounded to ~0.01° so tiny pans reuse the cached answer.
function cacheKey(cat: AreaCategory, b: Bounds): string {
  const r = (n: number) => n.toFixed(2);
  return `overpass:${cat.key}:${r(b.south)},${r(b.west)},${r(b.north)},${r(b.east)}`;
}

// The one non-network failure worth telling the user about: the viewport is too
// big to search. Everything else (down / rate-limited) degrades silently to [].
export class AreaTooBigError extends Error {
  constructor() {
    super('Zoom in to search a smaller area.');
    this.name = 'AreaTooBigError';
  }
}

// Search all POIs of a category inside the bbox. Throws AreaTooBigError when the
// viewport is too large to search politely; returns [] on any network failure
// (a down or rate-limited Overpass never throws into the UI).
export async function searchAreaPois(cat: AreaCategory, b: Bounds): Promise<PlaceResult[]> {
  if (bboxTooBig(b)) throw new AreaTooBigError();
  const key = cacheKey(cat, b);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  const gap = Date.now() - lastFetchAt;
  if (gap < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - gap);
  lastFetchAt = Date.now();

  try {
    // Overpass wants the query form-encoded as `data=`; the browser supplies its
    // own User-Agent (a request without one is rejected 406, but fetch always
    // sends the browser's, so we don't, and can't, set it here).
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(buildOverpassQuery(cat, b)),
    });
    if (!r.ok) return [];
    const results = normalizeOverpass(await r.json());
    mem.set(key, { at: Date.now(), results });
    return results;
  } catch {
    return [];
  }
}
