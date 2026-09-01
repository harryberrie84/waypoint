import { useEffect, useState } from 'react';
import { fetchForecast, forecastList, type ForecastDay } from '../lib/weather';

// The next few days at a pin's coordinates. Open-Meteo is keyless and cached per
// rounded lat/lon (see lib/weather), so opening a handful of pins on a trip makes a
// handful of requests, not one per open. Beyond its ~16-day window there is simply
// nothing to show, and this renders nothing rather than inventing a guess.

export function PinWeather({ lat, lon, days = 5 }: { lat: number; lon: number; days?: number }) {
  const [list, setList] = useState<ForecastDay[] | null>(null);

  useEffect(() => {
    let alive = true;
    setList(null);
    void fetchForecast(lat, lon)
      .then((map) => alive && setList(forecastList(map, days)))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [lat, lon, days]);

  if (list === null) {
    return <div className="mb-1.5 h-9 animate-pulse rounded-md bg-paper-panel dark:bg-coal-line" />;
  }
  if (list.length === 0) return null; // out of window, offline, or blocked

  return (
    <div className="mb-1.5 flex gap-1 overflow-x-auto rounded-md border border-paper-line px-1 py-1 dark:border-coal-line">
      {list.map((d) => (
        <div key={d.date} className="flex min-w-[3rem] flex-col items-center gap-0.5 px-1" title={`${d.label}${d.precip != null ? ` · ${d.precip}% rain` : ''}`}>
          <span className="text-[10px] font-medium uppercase text-ink-faint dark:text-coal-soft">{d.weekday}</span>
          <span className="text-sm leading-none">{d.emoji}</span>
          <span className="text-[10px] tabular-nums text-ink-soft dark:text-coal-soft">
            {Math.round(d.hi)}° / {Math.round(d.lo)}°
          </span>
          {d.precip != null && d.precip >= 30 && (
            <span className="text-[9px] tabular-nums text-clay">{d.precip}%</span>
          )}
        </div>
      ))}
    </div>
  );
}
