// ---------------------------------------------------------------------------
// dayRoute, the shape of a day's route across a set of stops.
// ---------------------------------------------------------------------------
// "How far is this day, and roughly how long am I moving?" Pure geometry over an
// ORDERED list of stops, so it needs no network and no day model: the caller
// decides what a day is (the pins currently shown, one table's rows for a date,
// a hand-picked selection) and hands them over in the order they should be walked.
//
// Distances are great-circle, deliberately. A real road route needs OSRM per leg,
// which is a request per pair and fails offline; a straight-line total is honest
// about being an estimate and is the right order of magnitude for "is this day
// over-stuffed". `estimated` is always true here so no caller can present it as
// a routed answer.

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface RouteStep {
  from: Stop;
  to: Stop;
  meters: number;
}

export interface DayRoute {
  stops: Stop[];
  steps: RouteStep[];
  totalMeters: number;
  /** Minutes on the move, from the mode's typical speed. */
  totalMinutes: number;
  estimated: true;
}

/** Metres per second, matching lib/routing's assumptions so the two agree. */
const SPEED: Record<'walking' | 'cycling' | 'driving', number> = {
  walking: 5 / 3.6,
  cycling: 15 / 3.6,
  driving: 16,
};

function haversineMeters(a: Stop, b: Stop): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The line through the stops, in the order given, with its total. */
export function buildDayRoute(stops: Stop[], mode: keyof typeof SPEED = 'walking'): DayRoute {
  const steps: RouteStep[] = [];
  for (let i = 1; i < stops.length; i++) {
    steps.push({ from: stops[i - 1], to: stops[i], meters: haversineMeters(stops[i - 1], stops[i]) });
  }
  const totalMeters = steps.reduce((n, s) => n + s.meters, 0);
  return {
    stops,
    steps,
    totalMeters,
    totalMinutes: Math.round(totalMeters / SPEED[mode] / 60),
    estimated: true,
  };
}

/**
 * Reorder stops nearest-neighbour from the first one, which is usually where you
 * are starting. Not the shortest possible tour (that is TSP), just a large and
 * cheap improvement on the order rows happen to be in. The first stop is kept as
 * the anchor so "start from the hotel" holds.
 */
export function orderByNearest(stops: Stop[]): Stop[] {
  if (stops.length < 3) return [...stops];
  const rest = stops.slice(1);
  const out = [stops[0]];
  while (rest.length) {
    const last = out[out.length - 1];
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = haversineMeters(last, rest[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    out.push(rest.splice(best, 1)[0]);
  }
  return out;
}

/** "3.2 km" / "480 m", for a label next to the line. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** "1 h 25 min" / "40 min". */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
