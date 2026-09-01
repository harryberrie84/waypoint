// ---------------------------------------------------------------------------
// Routing, real travel time/distance between two points via OSRM, plus the
// flight + auto-route helpers the workspace map uses.
// ---------------------------------------------------------------------------
// The public OSRM demo server only profiles `driving`: it returns the same car
// route for every profile, so walk/cycle used to come back with identical times.
// We only trust per-profile durations when VITE_OSRM_URL points at a self-hosted,
// multi-profile server; otherwise we take OSRM's distance/geometry and time the
// non-driving modes ourselves from a typical speed. Any failure returns a
// straight-line leg + a great-circle estimate, so a missing or rate-limited
// server never breaks the map.

export type RouteProfile = 'driving' | 'walking' | 'cycling';

export interface Leg {
  coords: [number, number][]; // [lat, lon] polyline to draw
  distanceM: number;
  durationS: number;
  estimated: boolean; // true = straight-line fallback, not a real road route
}

// Vite injects import.meta.env; in the node test runner it's absent, so read it
// defensively. A custom VITE_OSRM_URL is assumed to serve all three profiles.
const OSRM_BASE = (import.meta.env?.VITE_OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
const HAS_PROFILES = !!import.meta.env?.VITE_OSRM_URL;

// Typical moving speeds (m/s). `driving` is only used for the straight-line
// fallback; on a real route driving keeps OSRM's own duration.
const PROFILE_SPEED: Record<RouteProfile, number> = {
  driving: 16, // ~58 km/h
  walking: 5 / 3.6, // 5 km/h
  cycling: 15 / 3.6, // 15 km/h
};

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Pick a leg duration. driving uses OSRM's real road duration (it accounts for
// road speeds and turns); walking and cycling are timed from the route distance
// so the three modes never coincide on a driving-only server. A multi-profile
// server is handled before this is called, there we use its real per-profile
// duration straight from OSRM.
export function durationForProfile(profile: RouteProfile, distanceM: number, osrmDurationS: number): number {
  if (profile === 'driving') return osrmDurationS;
  return distanceM / PROFILE_SPEED[profile];
}

function straightLeg(a: [number, number], b: [number, number], profile: RouteProfile): Leg {
  const distanceM = haversineMeters(a, b);
  return { coords: [a, b], distanceM, durationS: distanceM / PROFILE_SPEED[profile], estimated: true };
}

/** Fetch one leg from OSRM, or fall back to a straight-line estimate. */
export async function fetchLeg(a: [number, number], b: [number, number], profile: RouteProfile): Promise<Leg> {
  // A driving-only server can't route walking/cycling, so unless we know the
  // server is multi-profile we ask for the driving geometry (a fine proxy for
  // the line on the map) and re-time the leg per mode below.
  const pathProfile = HAS_PROFILES ? profile : 'driving';
  const url =
    `${OSRM_BASE}/route/v1/${pathProfile}/` +
    `${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    const route = j?.routes?.[0];
    if (!route || !route.geometry?.coordinates?.length) return straightLeg(a, b, profile);
    const coords = (route.geometry.coordinates as [number, number][]).map(([lon, lat]) => [lat, lon] as [number, number]);
    const durationS = HAS_PROFILES ? route.duration : durationForProfile(profile, route.distance, route.duration);
    return { coords, distanceM: route.distance, durationS, estimated: false };
  } catch {
    return straightLeg(a, b, profile);
  }
}

// Great-circle flight estimate: ~800 km/h cruise plus a flat ~40 min for taxi,
// climb and descent so short hops aren't unrealistically quick. distanceM is the
// haversine distance between the two pins.
export function estimateFlightDurationS(distanceM: number): number {
  const cruiseKmh = 800;
  const fixedS = 40 * 60;
  return (distanceM / 1000 / cruiseKmh) * 3600 + fixedS;
}

// Auto-route heuristic: legs longer than ~700 km are drawn as a flight, shorter
// ones as a ground route. We only have coordinates here (no country data), so
// distance is the proxy for "different country / worth flying".
export const FLIGHT_THRESHOLD_M = 700_000;
export function autoLegMode(distanceM: number): 'flight' | 'drive' {
  return distanceM > FLIGHT_THRESHOLD_M ? 'flight' : 'drive';
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '';
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h} h ${rem}` : `${h} h`;
}

export const PROFILE_LABEL: Record<RouteProfile, string> = {
  driving: 'Drive',
  walking: 'Walk',
  cycling: 'Cycle',
};
