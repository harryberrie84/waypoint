import { useEffect, useState } from 'react';
import { fetchForecast, placeKey, type DayWeather } from '../lib/weather';

// useForecasts, fetch the daily forecast for each distinct place once, and hand
// back a lookup so a calendar/schedule can ask "(place, day) -> weather?" while
// rendering. Returns null until a place's data lands, or when the day is outside
// the forecast window.

export function useForecasts(places: { lat: number; lon: number }[]): (lat: number, lon: number, dayIso: string) => DayWeather | null {
  const [maps, setMaps] = useState<Record<string, Record<string, DayWeather>>>({});

  // Stable dependency: the sorted set of place keys.
  const keys = [...new Set(places.map((p) => placeKey(p.lat, p.lon)))].sort();
  const dep = keys.join('|');

  useEffect(() => {
    let cancelled = false;
    const uniq = new Map<string, { lat: number; lon: number }>();
    for (const p of places) uniq.set(placeKey(p.lat, p.lon), p);
    uniq.forEach((p, key) => {
      void fetchForecast(p.lat, p.lon).then((m) => {
        if (cancelled || Object.keys(m).length === 0) return;
        setMaps((prev) => ({ ...prev, [key]: m }));
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return (lat, lon, dayIso) => maps[placeKey(lat, lon)]?.[dayIso] ?? null;
}
