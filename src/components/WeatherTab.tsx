import { useEffect, useMemo, useState } from 'react';
import { CloudSun, Plus, Search, Loader2, X } from 'lucide-react';
import { useData } from '../store/useData';
import { useWorkspaceTables } from '../hooks/useScoped';
import { pageTables, collectEvents } from '../lib/tripViews';
import { derivePagePins } from '../lib/mapPins';
import { searchPlaces, type PlaceResult } from '../lib/places';
import { uid } from '../lib/id';
import { fetchForecast, forecastList, type ForecastDay } from '../lib/weather';
import { LockedBodyStrip } from './LockedBody';
import { isEnvelope } from '../lib/crypto';

// WeatherTab, the forecast for everywhere this page goes, in one grid.
//
// /weather is a block you place, and a map pin shows its own days; neither
// answers "what is the whole trip going to be like". This asks every distinct
// place on the page at once (deduplicated by rounded coordinate, so a hotel and a
// restaurant on the same block are one request) and lays the days out side by
// side. Open-Meteo is keyless and cached per place, so a trip with six locations
// makes six requests, once.
//
// Page-scoped like every other tab: places come from THIS page's pins and tables,
// never the workspace.

interface Place {
  key: string;
  name: string;
  lat: number;
  lon: number;
  days: ForecastDay[] | null; // null = still loading
}

export function WeatherTab({ pageId, editable = false, body }: { pageId: string; editable?: boolean; body?: object | null }) {
  const stored = useData((s) => s.pages[pageId]);
  const page = useMemo(() => (stored && body ? { ...stored, content: body } : stored), [stored, body]);
  const allTables = useWorkspaceTables();
  const tables = useMemo(() => pageTables(page, allTables), [page, allTables]);
  const rows = useData((s) => s.rows);
  const tablesById = useData((s) => s.tables);
  const setPageMap = useData((s) => s.setPageMap);
  const [count, setCount] = useState(7);

  // Every place the page knows about: manual pins, pins derived from its tables,
  // and its linked map sources. Deduped to two decimal places, which is about a
  // kilometre: finer than that is the same forecast.
  const found = useMemo(() => {
    const map = page?.map ?? { pins: [], routes: [] };
    const derived = derivePagePins(page?.content ?? null, map.sources ?? [], tablesById, rows);
    const seen = new Set<string>();
    const out: { key: string; name: string; lat: number; lon: number }[] = [];
    for (const p of [...(map.pins ?? []), ...derived]) {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, name: p.name || 'Place', lat: p.lat, lon: p.lon });
    }
    return out;
  }, [page, tablesById, rows]);
  // A sane ceiling; nobody reads 40 forecast rows. Said out loud when it bites,
  // or a place you just added silently isn't here.
  const places = useMemo(() => found.slice(0, 12), [found]);

  // Add a place without leaving the tab. It goes into the page's OWN map pins
  // (pages.map), the same field the Map tab writes, so the place shows up on both
  // and nothing is appended to your notes. Places made anywhere else on this page
  // (a pin, a table's place column) already arrive here on their own.
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    // The map's search box debounce: searchPlaces caches and respects Nominatim's
    // rate limit, but there is no reason to ask it on every keystroke.
    const t = setTimeout(async () => {
      const hits = await searchPlaces(q);
      if (cancelled) return;
      setResults(hits);
      setSearching(false);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const addPlace = (r: PlaceResult) => {
    const map = page?.map ?? { pins: [], routes: [] };
    setPageMap(pageId, {
      ...map,
      pins: [...(map.pins ?? []), { id: uid('pin'), lat: r.lat, lon: r.lon, name: r.name, kind: 'place' }],
    });
    setQuery('');
    setResults([]);
    setAdding(false);
  };

  // The first dated day on the page, so the grid leads with the trip rather than
  // with today when the trip is still ahead.
  const from = useMemo(() => {
    const events = collectEvents(tables, rows, []);
    const days = events.map((e) => e.day).sort();
    return days[0] ?? null;
  }, [tables, rows]);

  const [loaded, setLoaded] = useState<Record<string, ForecastDay[]>>({});
  useEffect(() => {
    let alive = true;
    for (const p of places) {
      if (loaded[p.key]) continue;
      void fetchForecast(p.lat, p.lon)
        .then((m) => {
          if (alive) setLoaded((cur) => ({ ...cur, [p.key]: forecastList(m, 14, from) }));
        })
        .catch(() => {
          if (alive) setLoaded((cur) => ({ ...cur, [p.key]: [] }));
        });
    }
    return () => {
      alive = false;
    };
  }, [places, from, loaded]);

  const rowsOut: Place[] = places.map((p) => ({ ...p, days: loaded[p.key] ?? null }));
  const unreadable = isEnvelope(stored?.content) && !body;

  const addButton = editable ? (
    <button
      type="button"
      onClick={() => setAdding((v) => !v)}
      className="flex items-center gap-1 rounded-lg border border-paper-line px-2 py-0.5 text-[11px] font-medium text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft"
    >
      <Plus className="h-3 w-3" /> Add place
    </button>
  ) : null;

  // Inline rather than a floating dropdown: this tab scrolls, and a popover would
  // want the portal treatment for no gain.
  const addPanel =
    editable && adding ? (
      <div className="mb-3 rounded-xl border border-paper-line p-2 dark:border-coal-line">
        <div className="flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper px-2 dark:border-coal-line dark:bg-coal-panel">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a place, e.g. Fukuoka"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ink outline-none dark:text-coal-text"
          />
          {searching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-faint" />}
          <button type="button" onClick={() => { setAdding(false); setQuery(''); }} className="shrink-0 rounded p-0.5 text-ink-faint hover:text-clay" title="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {results.length > 0 && (
          <div className="mt-1 max-h-56 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => addPlace(r)}
                className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-paper-panel dark:hover:bg-coal-line"
              >
                <span className="text-xs text-ink dark:text-coal-text">{r.name}</span>
                {r.address && <span className="line-clamp-1 text-[10px] text-ink-faint dark:text-coal-soft">{r.address}</span>}
              </button>
            ))}
          </div>
        )}
        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-ink-faint dark:text-coal-soft">Nothing found. Try another spelling.</p>
        )}
        <p className="px-2 pt-1 text-[10px] text-ink-faint dark:text-coal-soft">Saved as a pin on this page, so it shows on the Map tab too. Nothing is added to your notes.</p>
      </div>
    ) : null;

  if (places.length === 0) {
    return (
      <div className="mx-auto h-full max-w-4xl px-3 py-4 sm:px-6">
        {unreadable && <LockedBodyStrip what="places" />}
        {addPanel}
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-clay-wash text-clay dark:bg-clay/15">
            <CloudSun className="h-5 w-5" />
          </div>
          <p className="text-sm text-ink-soft dark:text-coal-soft">No places on this page yet.</p>
          <p className="max-w-xs text-xs text-ink-faint dark:text-coal-soft">
            Add one here, drop a pin on the Map tab, or give a table a <span className="font-medium">Place</span>{' '}
            column, and the forecast for everywhere you are going shows up here.
          </p>
          {addButton}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-5xl overflow-auto px-3 py-4 sm:px-6">
      {unreadable && <LockedBodyStrip what="places" />}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CloudSun className="h-4 w-4 text-clay" />
        <h2 className="text-sm font-semibold text-ink dark:text-coal-text">Weather</h2>
        <span className="text-[11px] text-ink-faint dark:text-coal-soft">
          {found.length > places.length ? `${places.length} of ${found.length} places` : `${places.length} place${places.length === 1 ? '' : 's'}`}
          {from ? ` from ${from}` : ''}
        </span>
        {addButton}
        <div className="ml-auto flex overflow-hidden rounded-md border border-paper-line dark:border-coal-line">
          {[3, 7, 14].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              className={[
                'px-2 py-0.5 text-[11px] font-medium',
                count === n ? 'bg-clay text-white' : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
              ].join(' ')}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>
      {addPanel}

      <div className="space-y-2">
        {rowsOut.map((p) => (
          <div key={p.key} className="rounded-xl border border-paper-line p-2 dark:border-coal-line">
            <div className="mb-1.5 truncate px-1 text-xs font-medium text-ink dark:text-coal-text">{p.name}</div>
            {p.days === null ? (
              <div className="h-12 animate-pulse rounded-md bg-paper-panel dark:bg-coal-line" />
            ) : p.days.length === 0 ? (
              <p className="px-1 text-[11px] text-ink-faint dark:text-coal-soft">
                No forecast for these dates. Open-Meteo only reaches about 16 days ahead.
              </p>
            ) : (
              <div className="flex gap-1 overflow-x-auto">
                {p.days.slice(0, count).map((d) => (
                  <div
                    key={d.date}
                    className="flex min-w-[3.25rem] flex-col items-center gap-0.5 rounded-md px-1 py-1"
                    title={`${d.label}${d.precip != null ? ` · ${d.precip}% rain` : ''}`}
                  >
                    <span className="text-[10px] font-medium uppercase text-ink-faint dark:text-coal-soft">{d.weekday}</span>
                    <span className="text-base leading-none">{d.emoji}</span>
                    <span className="text-[10px] tabular-nums text-ink-soft dark:text-coal-soft">
                      {Math.round(d.hi)}° / {Math.round(d.lo)}°
                    </span>
                    {d.precip != null && d.precip >= 30 && <span className="text-[9px] tabular-nums text-clay">{d.precip}%</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
