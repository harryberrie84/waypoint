import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { CloudSun, Search, Loader2, RefreshCw, CalendarDays, Droplets } from 'lucide-react';
import { fetchForecast, forecastList, type DayWeather } from '../lib/weather';
import { useAutoFocus } from './useAutoFocus';

// ---------------------------------------------------------------------------
// weatherBlock, a forecast card for a destination. Unlike /place (a live clock
// for a city), this is forecast-first: pick a place, see the next few days'
// conditions and hi/lo so you can plan around the wet day. Geocoding + forecast
// come from the free, keyless Open-Meteo API (fetchForecast in lib/weather,
// cached per place). Open-Meteo only forecasts ~16 days out.
// ---------------------------------------------------------------------------

const DAY_CHOICES = [3, 7, 10, 14];

function WeatherView({ node, updateAttributes, editor }: NodeViewProps) {
  const name = node.attrs.name as string;
  const country = node.attrs.country as string;
  const lat = node.attrs.lat as number | null;
  const lon = node.attrs.lon as number | null;
  const days = (node.attrs.days as number) ?? 7;
  const start = (node.attrs.start as string) ?? '';
  const editable = editor.isEditable;

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useAutoFocus<HTMLInputElement>((lat == null || lon == null) && editable);
  const [wxMap, setWxMap] = useState<Record<string, DayWeather> | null>(null);

  // Pull the cached daily forecast when the place changes. The start-date and
  // day-count reslice happen in render, so changing them makes no new request.
  useEffect(() => {
    if (lat == null || lon == null) return;
    let cancelled = false;
    setWxMap(null);
    void fetchForecast(lat, lon).then((m) => {
      if (!cancelled) setWxMap(m);
    });
    return () => {
      cancelled = true;
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
        updateAttributes({ name: hit.name, country: hit.country ?? '', lat: hit.latitude, lon: hit.longitude });
      }
    } catch {
      setError('Lookup failed, check your connection.');
    }
    setSearching(false);
  };

  // --- Unset: place search --------------------------------------------------
  if (lat == null || lon == null) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <div className="rounded-xl border border-paper-line bg-paper-panel/50 p-4 dark:border-coal-line dark:bg-coal/40">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <CloudSun className="h-3.5 w-3.5 text-clay" /> Weather forecast
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
                    placeholder="Place, e.g. Fukuoka"
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

  // --- Set: the forecast grid ----------------------------------------------
  const show = wxMap ? forecastList(wxMap, days, start || undefined) : null;

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <div className="group relative overflow-hidden rounded-xl border border-paper-line bg-gradient-to-br from-clay-wash/60 to-paper-panel/40 p-4 dark:border-coal-line dark:from-clay/10 dark:to-coal/40">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-coal-text">
          <CloudSun className="h-4 w-4 shrink-0 text-clay" />
          <span className="truncate">{name}</span>
          {country && <span className="truncate text-xs font-normal text-ink-faint dark:text-coal-soft">· {country}</span>}
        </div>

        {show == null ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint dark:text-coal-soft">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading forecast…
          </div>
        ) : show.length === 0 ? (
          <p className="mt-3 text-xs text-ink-faint dark:text-coal-soft">No forecast available for this place.</p>
        ) : (
          <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(show.length, 7)}, minmax(0, 1fr))` }}>
            {show.map((f, i) => (
              <div key={f.date} className="rounded-lg bg-paper/60 px-1 py-2 text-center dark:bg-coal/40">
                <div className="text-[10px] font-medium text-ink-faint dark:text-coal-soft">{i === 0 && !start ? 'Today' : f.weekday}</div>
                <div className="text-2xl leading-none" title={f.label}>{f.emoji}</div>
                <div className="mt-1 font-mono text-[11px] font-semibold text-ink dark:text-coal-text">{f.hi}°</div>
                <div className="font-mono text-[10px] text-ink-faint dark:text-coal-soft">{f.lo}°</div>
                {f.precip != null && f.precip > 0 && (
                  <div className="mt-0.5 flex items-center justify-center gap-0.5 text-[9px] text-sky-500 dark:text-sky-400" title="chance of rain">
                    <Droplets className="h-2.5 w-2.5" /> {f.precip}%
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {editable && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-faint dark:text-coal-soft">
            <div className="flex items-center gap-1">
              <span className="mr-1">Days</span>
              {DAY_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => updateAttributes({ days: d })}
                  className={`rounded px-1.5 py-0.5 ${days === d ? 'bg-clay text-white' : 'hover:bg-paper-panel dark:hover:bg-coal-line'}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1" title="Start the forecast on a day (within the ~16-day window)">
              <CalendarDays className="h-3 w-3" />
              <input
                type="date"
                value={start}
                onChange={(e) => updateAttributes({ start: e.target.value })}
                className="rounded border border-paper-line bg-transparent px-1 py-0.5 text-[10px] text-ink outline-none dark:border-coal-line dark:text-coal-text"
              />
              {start && (
                <button type="button" onClick={() => updateAttributes({ start: '' })} className="rounded px-1 hover:text-clay" title="From today">
                  clear
                </button>
              )}
            </label>
          </div>
        )}

        {editable && (
          <button
            type="button"
            onClick={() => updateAttributes({ name: '', country: '', lat: null, lon: null })}
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

export const WeatherBlock = Node.create({
  name: 'weatherBlock',
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
      days: { default: 7 },
      start: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-weather-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-weather-block': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WeatherView);
  },
});
