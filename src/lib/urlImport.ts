import type { GeoValue } from '../types';
import { normalizeUrl, domainOf } from './linkMeta';

// ---------------------------------------------------------------------------
// urlImport, pure parsing of a pasted URL into a plan for auto-filling a row.
// Google Maps links carry a place name and/or coordinates we can read straight
// out of the URL (no fetch); hotel/flight/booking links give us a title from the
// path slug. Everything here is pure and best-effort: the component layer adds a
// Microlink title and a geocode when those help, and falls back to manual entry.
// ---------------------------------------------------------------------------

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' ')).trim();
  } catch {
    return s.replace(/\+/g, ' ').trim();
  }
}

// "grand-hyatt-fukuoka" / "Grand+Hyatt" → "Grand Hyatt Fukuoka".
export function prettifySlug(raw: string): string {
  const words = decodeSeg(raw)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words.map((w) => (/[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

function isMapsHost(host: string): boolean {
  return /(^|\.)google\.[a-z.]+$/.test(host) || host === 'maps.app.goo.gl' || host === 'goo.gl';
}

export interface MapsParse {
  name?: string;
  lat?: number;
  lon?: number;
}

// Read what a Google Maps URL exposes directly. Returns null for non-maps hosts.
// Short links (maps.app.goo.gl) carry no data, so we may return an empty object.
export function parseGoogleMapsUrl(url: string): MapsParse | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isMapsHost(u.hostname) && !/\/maps(\/|$|\?)/.test(u.pathname)) return null;

  const out: MapsParse = {};

  // Coordinates: the "@lat,lon" in the path, then a coord-valued query param,
  // then the "!3dLAT!4dLON" data segment. First hit wins.
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
  const qll = /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
  const data = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url);
  const coord = at ?? qll ?? data;
  if (coord) {
    const lat = Number(coord[1]);
    const lon = Number(coord[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      out.lat = lat;
      out.lon = lon;
    }
  }

  // Name: the "/place/<name>/" segment, else a non-coordinate q/query value.
  const place = /\/maps\/place\/([^/@]+)/.exec(u.pathname);
  if (place) {
    out.name = decodeSeg(place[1]);
  } else {
    const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
    if (q && !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(q)) out.name = decodeSeg(q);
  }

  return out.name || out.lat !== undefined ? out : {};
}

// Best-effort title from a non-maps URL: the last hyphenated path slug, else the
// domain. Microlink usually replaces this with the real page title later.
export function titleFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const slug = [...segs].reverse().find((s) => {
    const d = decodeSeg(s).replace(/\.[a-z0-9]{1,5}$/i, '');
    return /[-_ ]/.test(d) && !/^\d+$/.test(d);
  });
  if (slug) {
    const pretty = prettifySlug(decodeSeg(slug).replace(/\.[a-z0-9]{1,5}$/i, ''));
    if (pretty.length >= 2) return pretty;
  }
  return domainOf(url);
}

export interface UrlImportPlan {
  url: string; // normalized
  title: string; // best title we can derive without a fetch
  geo: GeoValue | null; // set when the URL carried coordinates (Google Maps)
  placeQuery: string; // a name to geocode when geo is null
  isMaps: boolean;
}

// Plan how to fill a row from a pasted URL. Pure, no network. The caller wires
// the result into columns and may refine the title (Microlink) and resolve a
// place (geocode) from placeQuery.
export function planUrlImport(raw: string): UrlImportPlan {
  const url = normalizeUrl(raw);
  if (!url) return { url: '', title: '', geo: null, placeQuery: '', isMaps: false };

  const maps = parseGoogleMapsUrl(url);
  if (maps) {
    const name = maps.name ?? '';
    const hasCoord = maps.lat !== undefined && maps.lon !== undefined;
    const geo: GeoValue | null = hasCoord
      ? { name: name || `${maps.lat!.toFixed(4)}, ${maps.lon!.toFixed(4)}`, lat: maps.lat!, lon: maps.lon! }
      : null;
    return {
      url,
      title: name || (geo ? geo.name : domainOf(url)),
      geo,
      placeQuery: name, // geocode the name when there were no coords
      isMaps: true,
    };
  }

  const title = titleFromUrl(url);
  return { url, title, geo: null, placeQuery: '', isMaps: false };
}
