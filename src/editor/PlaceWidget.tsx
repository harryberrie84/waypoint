import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { MapPin, Search, Loader2, RefreshCw } from 'lucide-react';
import { weatherInfo } from '../lib/weather';
import { useAutoFocus } from './useAutoFocus';

// ---------------------------------------------------------------------------
// placeWidget, a live clock for a city, with its current weather and date.
// Geocoding + weather come from the free, keyless Open-Meteo API (resolved in
// the browser). The node stores the resolved place so it reloads instantly.
// ---------------------------------------------------------------------------

// WMO code -> emoji/label lives in lib/weather; re-exported here for tests.
export { weatherInfo };

export function formatInZone(date: Date, timezone: string | undefined, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timezone || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', opts).format(date);
  }
}

export interface DailyForecast {
  date: string;
  label: string;
  emoji: string;
  hi: number;
  lo: number;
}

interface DailyRaw {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  weather_code?: number[];
}

export function forecastDays(daily: DailyRaw | null, count: number): DailyForecast[] {
  if (!daily || !Array.isArray(daily.time)) return [];
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out: DailyForecast[] = [];
  const n = Math.min(count, daily.time.length);
  for (let i = 0; i < n; i++) {
    const iso = daily.time[i];
    const [y, m, d] = iso.split('-').map(Number);
    out.push({
      date: iso,
      label: i === 0 ? 'Today' : wd[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
      emoji: weatherInfo(daily.weather_code?.[i]).emoji,
      hi: Math.round(daily.temperature_2m_max?.[i] ?? 0),
      lo: Math.round(daily.temperature_2m_min?.[i] ?? 0),
    });
  }
  return out;
}

interface Weather {
  temp: number;
  code: number;
}

function PlaceWidgetView({ node, updateAttributes, editor }: NodeViewProps) {
  const name = node.attrs.name as string;
  const country = node.attrs.country as string;
  const lat = node.attrs.lat as number | null;
  const lon = node.attrs.lon as number | null;
  const timezone = node.attrs.timezone as string;
  const days = (node.attrs.days as number) ?? 1;
  const editable = editor.isEditable;

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useAutoFocus<HTMLInputElement>((lat == null || lon == null) && editable);
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(null);
  const [forecast, setForecast] = useState<DailyRaw | null>(null);

  // Tick the clock every second.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch a 7-day daily forecast when the place changes.
  useEffect(() => {
    if (lat == null || lon == null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7&timezone=auto`,
        );
        const j = await r.json();
        if (!cancelled && j.daily) setForecast(j.daily as DailyRaw);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  // Fetch current weather when the place changes, then refresh every 10 min.
  useEffect(() => {
    if (lat == null || lon == null) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,
        );
        const j = await r.json();
        if (!cancelled && j.current) setWeather({ temp: j.current.temperature_2m, code: j.current.weather_code });
      } catch {
        /* offline / blocked, clock + date still work */
      }
    };
    void load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [lat, lon]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError('');
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`);
      const j = await r.json();
      const hit = j.results && j.results[0];
      if (!hit) {
        setError('No place found, try another spelling.');
      } else {
        updateAttributes({
          name: hit.name,
          country: hit.country ?? '',
          lat: hit.latitude,
          lon: hit.longitude,
          timezone: hit.timezone ?? '',
        });
      }
    } catch {
      setError('Lookup failed, check your connection.');
    }
    setSearching(false);
  };

  // --- Unset: show the city search -----------------------------------------
  if (lat == null || lon == null) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="rounded-xl border border-paper-line bg-paper-panel/50 p-4 dark:border-coal-line dark:bg-coal/40">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <MapPin className="h-3.5 w-3.5 text-clay" /> Add a place
          </div>
          {editable ? (
            <>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2 dark:border-coal-line dark:bg-coal-panel">
                  <Search className="h-3.5 w-3.5 text-ink-faint" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && search()}
                    placeholder="City, e.g. Fukuoka"
                    className="flex-1 bg-transparent py-1.5 text-sm text-ink outline-none dark:text-coal-text"
                  />
                </div>
                <button
                  type="button"
                  onClick={search}
                  disabled={searching}
                  className="flex items-center gap-1.5 rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-60"
                >
                  {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Add
                </button>
              </div>
              {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
            </>
          ) : (
            <p className="text-sm text-ink-faint dark:text-coal-soft">No place set.</p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  // --- Set: live clock + weather + date ------------------------------------
  const time = formatInZone(now, timezone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const dateStr = formatInZone(now, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const wx = weather ? weatherInfo(weather.code) : null;

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="relative overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/60 to-paper-panel/40 p-4 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-coal-text">
              <MapPin className="h-4 w-4 shrink-0 text-clay" />
              <span className="truncate">{name}</span>
              {country && <span className="truncate text-xs font-normal text-ink-faint dark:text-coal-soft">· {country}</span>}
            </div>
            <div className="mt-2 font-mono text-4xl font-bold tabular-nums tracking-tight text-ink dark:text-coal-text">
              {time}
            </div>
            <div className="mt-1 text-xs text-ink-soft dark:text-coal-soft">{dateStr}</div>
            {timezone && <div className="text-[10px] text-ink-faint dark:text-coal-soft/70">{timezone}</div>}
          </div>

          <div className="shrink-0 text-right">
            {wx ? (
              <>
                <div className="text-3xl leading-none">{wx.emoji}</div>
                <div className="mt-1 font-mono text-lg font-semibold text-ink dark:text-coal-text">
                  {Math.round(weather!.temp)}°C
                </div>
                <div className="text-[11px] text-ink-faint dark:text-coal-soft">{wx.label}</div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
                <Loader2 className="h-3 w-3 animate-spin" /> weather
              </div>
            )}
          </div>
        </div>

        {days > 1 && (
          <div
            className="mt-3 grid gap-1"
            style={{ gridTemplateColumns: `repeat(${Math.min(days, 7)}, minmax(0, 1fr))` }}
          >
            {forecastDays(forecast, days).map((f) => (
              <div key={f.date} className="rounded-lg bg-paper/60 px-1 py-2 text-center dark:bg-coal/40">
                <div className="text-[10px] font-medium text-ink-faint dark:text-coal-soft">{f.label}</div>
                <div className="text-lg leading-none">{f.emoji}</div>
                <div className="mt-1 font-mono text-[11px] text-ink dark:text-coal-text">{f.hi}°</div>
                <div className="font-mono text-[10px] text-ink-faint dark:text-coal-soft">{f.lo}°</div>
              </div>
            ))}
            {forecast == null && (
              <div className="col-span-full text-center text-[11px] text-ink-faint dark:text-coal-soft">loading forecast…</div>
            )}
          </div>
        )}

        {editable && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-ink-faint dark:text-coal-soft">
            <span className="mr-1">Forecast</span>
            {[1, 3, 5, 7].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => updateAttributes({ days: d })}
                className={`rounded px-1.5 py-0.5 ${days === d ? 'bg-clay text-white' : 'hover:bg-paper-panel dark:hover:bg-coal-line'}`}
              >
                {d === 1 ? 'now' : `${d}d`}
              </button>
            ))}
          </div>
        )}

        {editable && (
          <button
            type="button"
            onClick={() => updateAttributes({ name: '', country: '', lat: null, lon: null, timezone: '' })}
            className="absolute right-2 top-2 rounded-md p-1 text-ink-faint opacity-0 transition-opacity hover:bg-paper-panel hover:text-clay group-hover:opacity-100 dark:hover:bg-coal-line"
            title="Change place"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const PlaceWidget = Node.create({
  name: 'placeWidget',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: { default: '' },
      country: { default: '' },
      lat: { default: null },
      lon: { default: null },
      timezone: { default: '' },
      days: { default: 1 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-place-widget]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-place-widget': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlaceWidgetView);
  },
});
