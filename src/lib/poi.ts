import type { GeoValue } from '../types';
import { searchPlaces, type PlaceResult } from './places';

// ---------------------------------------------------------------------------
// poi, the richer place source behind the Place picker. The network, caching
// and Nominatim rate-limiting all live in places.ts (which now asks for OSM
// `extratags`); this module is the thin POI-flavoured face of it: a search that
// returns enriched results, plus the pure conversion + display helpers shared by
// the picker and the map popups. Pure parts are tested directly.
//
// OSM carries no review rating. We surface what it actually has, category,
// cuisine, opening hours, contact, and a hotel `stars` class where tagged, but
// never invent a score.
// ---------------------------------------------------------------------------

// Search for POIs by name, biased toward `near` (the current map centre) when
// given. Delegates to places.searchPlaces, so it inherits the cache + rate limit
// and returns [] (never throws) on failure.
export async function searchPois(query: string, near?: { lat: number; lon: number }): Promise<PlaceResult[]> {
  return searchPlaces(query, near);
}

// Convert a search result into the value stored in a Place cell. Only sets the
// optional fields OSM actually provided, so the cell stays compact when a place
// is sparsely tagged.
export function poiToGeo(p: PlaceResult): GeoValue {
  const geo: GeoValue = { name: p.name, lat: p.lat, lon: p.lon };
  if (p.category) geo.category = p.category;
  if (p.cuisine) geo.cuisine = p.cuisine;
  if (p.openingHours) geo.openingHours = p.openingHours;
  if (p.website) geo.website = p.website;
  if (p.phone) geo.phone = p.phone;
  if (p.address) geo.address = p.address;
  if (typeof p.stars === 'number') geo.stars = p.stars;
  return geo;
}

// A short, human label for a category/cuisine, e.g. "restaurant · ramen". OSM
// cuisine tags are semicolon-separated; we show the first couple.
export function categoryLabel(geo: GeoValue): string {
  const parts: string[] = [];
  if (geo.category) parts.push(geo.category.replace(/_/g, ' '));
  if (geo.cuisine) parts.push(geo.cuisine.split(';').slice(0, 2).join(', '));
  return parts.join(' · ');
}

// Display lines for the picker and map popups, only the fields that are set.
export function geoDetailLines(geo: GeoValue): string[] {
  const lines: string[] = [];
  const cat = categoryLabel(geo);
  if (cat) lines.push(cat);
  if (typeof geo.stars === 'number') lines.push(`${'★'.repeat(Math.min(5, Math.round(geo.stars)))} ${geo.stars}-star`);
  if (geo.openingHours) lines.push(geo.openingHours);
  if (geo.phone) lines.push(geo.phone);
  return lines;
}
