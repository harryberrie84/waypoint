// ---------------------------------------------------------------------------
// weather, cached daily forecasts from the free, keyless Open-Meteo API.
// ---------------------------------------------------------------------------
// Calendar and schedule headers ask "what's the weather at this place on this
// day?" Open-Meteo only forecasts ~16 days out, so days beyond that (or in the
// past) simply return null, the header shows nothing rather than a guess.
// Results are cached per rounded lat/lon so a trip with a handful of places
// makes a handful of requests, shared across every day cell.

export interface DayWeather {
  code: number;
  hi: number;
  lo: number;
  emoji: string;
  label: string;
  precip?: number; // max chance of precipitation that day, 0-100 (absent if unknown)
}

// WMO weather code -> emoji + label. The single source of truth (PlaceWidget
// re-exports this).
export function weatherInfo(code: number | null | undefined): { emoji: string; label: string } {
  if (code == null) return { emoji: '·', label: '' };
  if (code === 0) return { emoji: '☀️', label: 'Clear' };
  if (code === 1 || code === 2) return { emoji: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { emoji: '☁️', label: 'Overcast' };
  if (code === 45 || code === 48) return { emoji: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { emoji: '🌧️', label: 'Rain' };
  if (code >= 71 && code <= 77) return { emoji: '❄️', label: 'Snow' };
  if (code >= 80 && code <= 82) return { emoji: '🌧️', label: 'Showers' };
  if (code === 85 || code === 86) return { emoji: '🌨️', label: 'Snow showers' };
  if (code >= 95) return { emoji: '⛈️', label: 'Thunderstorm' };
  return { emoji: '·', label: '' };
}

export function placeKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export interface ForecastDay extends DayWeather {
  date: string;
  weekday: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Turn the date-keyed forecast map into an ordered list of up to `count` days,
// each tagged with a short weekday. Optionally start from a given ISO date (so a
// trip day can lead the list); an out-of-window start just falls back to today.
export function forecastList(
  map: Record<string, DayWeather>,
  count: number,
  fromIso?: string | null,
): ForecastDay[] {
  const dates = Object.keys(map).sort();
  let start = 0;
  if (fromIso) {
    const at = dates.indexOf(fromIso.slice(0, 10));
    if (at >= 0) start = at;
  }
  const out: ForecastDay[] = [];
  for (let i = start; i < dates.length && out.length < count; i++) {
    const iso = dates[i];
    const [y, m, d] = iso.split('-').map(Number);
    out.push({ ...map[iso], date: iso, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] });
  }
  return out;
}

const cache = new Map<string, Promise<Record<string, DayWeather>>>();

async function load(lat: number, lon: number): Promise<Record<string, DayWeather>> {
  const out: Record<string, DayWeather> = {};
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&forecast_days=16&timezone=auto`,
    );
    const j = await r.json();
    const d = j.daily;
    if (d && Array.isArray(d.time)) {
      for (let i = 0; i < d.time.length; i++) {
        const code = d.weather_code?.[i] ?? null;
        const wi = weatherInfo(code);
        const pop = d.precipitation_probability_max?.[i];
        out[d.time[i]] = {
          code: code ?? -1,
          hi: Math.round(d.temperature_2m_max?.[i] ?? 0),
          lo: Math.round(d.temperature_2m_min?.[i] ?? 0),
          emoji: wi.emoji,
          label: wi.label,
          precip: typeof pop === 'number' ? pop : undefined,
        };
      }
    }
  } catch {
    /* offline / blocked, day headers just omit weather */
  }
  return out;
}

/** Daily forecast for a place, cached. Empty results aren't cached, so a failed
 *  fetch is retried on the next call rather than poisoning the place forever. */
export function fetchForecast(lat: number, lon: number): Promise<Record<string, DayWeather>> {
  const key = placeKey(lat, lon);
  let p = cache.get(key);
  if (!p) {
    p = load(lat, lon).then((m) => {
      if (Object.keys(m).length === 0) cache.delete(key);
      return m;
    });
    cache.set(key, p);
  }
  return p;
}
