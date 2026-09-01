// ---------------------------------------------------------------------------
// Currency conversion
// ---------------------------------------------------------------------------
// A small rate cache so formulas can convert money (`fx([Total], 'JPY', 'SEK')`).
// Rates come from the free, keyless open.er-api.com (base USD) and are cached in
// localStorage, so once fetched the conversion keeps working offline. The cache
// is module-scoped and read synchronously by the formula engine; the async
// refresh and the notify() that re-renders dependent views live in the store
// (refreshRates) + TableView (useFxVersion).

const CACHE_KEY = 'waypoint:fx';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // refetch at most twice a day

export interface RateCache {
  base: string; // currency all rates are relative to (USD from open.er-api)
  rates: Record<string, number>; // CODE -> units of CODE per 1 base
  fetchedAt: number; // epoch ms
}

let cache: RateCache | null = loadCache();

function loadCache(): RateCache | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateCache;
    return parsed.rates && parsed.base ? parsed : null;
  } catch {
    return null;
  }
}

// --- Reactive nudge ---------------------------------------------------------
// Views that show converted formulas subscribe so they recompute once rates land.
let version = 0;
const listeners = new Set<() => void>();

export function subscribeFx(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function fxVersion(): number {
  return version;
}

export function setRates(next: RateCache): void {
  cache = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  version++;
  listeners.forEach((fn) => fn());
}

export function ratesAreStale(): boolean {
  return !cache || Date.now() - cache.fetchedAt > MAX_AGE_MS;
}

/** When the cached rates were fetched (0 = never). The currency board shows this
 *  so "live" never means more than it is: the free upstream publishes daily. */
export function ratesFetchedAt(): number {
  return cache?.fetchedAt ?? 0;
}

/** Every code the cached table knows, for the board's picker. Empty until the
 *  first fetch lands. */
export function knownCodes(): string[] {
  return cache ? [cache.base, ...Object.keys(cache.rates)] : [];
}

/** Fetch fresh rates. Throws on network failure, the caller falls back to cache. */
export async function fetchRates(): Promise<RateCache> {
  const r = await fetch('https://open.er-api.com/v6/latest/USD');
  const j = await r.json();
  if (!j || j.result !== 'success' || !j.rates) throw new Error('fx: bad response');
  return { base: j.base_code || 'USD', rates: j.rates as Record<string, number>, fetchedAt: Date.now() };
}

/**
 * Convert `amount` from one ISO currency code to another. Returns NaN when the
 * codes are unknown and no rate is cached yet, so the formula shows #ERR rather
 * than a wrong number. A pinned `manual` rate (units of `to` per 1 `from`) skips
 * the table entirely.
 */
export function convert(amount: number, from: string, to: string, manual?: number): number {
  if (typeof manual === 'number' && Number.isFinite(manual)) return amount * manual;
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amount;
  if (!cache) return NaN;
  const rf = f === cache.base ? 1 : cache.rates[f];
  const rt = t === cache.base ? 1 : cache.rates[t];
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

// Default resolver handed to the formula engine for the fx() function.
export function fxResolve(amount: number, from: string, to: string, manual?: number): number {
  return convert(amount, from, to, manual);
}

// --- Workspace base currency ------------------------------------------------
// The one currency everything settles into. Mirrored to localStorage (per the
// views/automations/cover pattern) so it survives reloads with no PB field. The
// budget preset bakes this into its "In base" column at creation time, and the
// settlement block reads it live, one place, read in both. Changing it nudges
// fx subscribers so open summaries recompute.
const BASE_KEY = 'waypoint:basecurrency';

// Region to currency, so a fresh install opens in the money the person actually
// spends rather than one country's. Only the region matters, not the language, so
// en-SE and sv-SE both land on SEK. Anything unlisted falls back to USD: a neutral
// guess beats a confident wrong one, and this only decides what they see before
// they set it themselves.
const REGION_CURRENCY: Record<string, string> = {
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR', LV: 'EUR',
  MT: 'EUR', NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR',
  AU: 'AUD', BR: 'BRL', CA: 'CAD', CH: 'CHF', CN: 'CNY', CZ: 'CZK', DK: 'DKK',
  GB: 'GBP', HK: 'HKD', HU: 'HUF', ID: 'IDR', IN: 'INR', JP: 'JPY', KR: 'KRW',
  MX: 'MXN', MY: 'MYR', NO: 'NOK', NZ: 'NZD', PH: 'PHP', PL: 'PLN', RO: 'RON',
  SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', TW: 'TWD', US: 'USD', VN: 'VND',
  ZA: 'ZAR',
};

export const DEFAULT_BASE = 'USD';

// Exported so the money surfaces can show what a fresh install would pick. Off a
// browser (the node test runner) there is no locale, so this is DEFAULT_BASE.
export function localeBaseCurrency(): string {
  try {
    const tag = typeof navigator !== 'undefined' ? navigator.language : '';
    if (!tag) return DEFAULT_BASE;
    // Intl.Locale parses "en-GB" and "zh-Hant-TW" alike; the split is the fallback
    // for engines without it, where a region is the only 2-letter uppercase part.
    const region = new Intl.Locale(tag).region || tag.split('-').find((p) => /^[A-Z]{2}$/.test(p));
    return (region && REGION_CURRENCY[region.toUpperCase()]) || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

export function getBaseCurrency(): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(BASE_KEY)) || localeBaseCurrency();
  } catch {
    return localeBaseCurrency();
  }
}

export function setBaseCurrency(code: string): void {
  const next = code.trim().toUpperCase() || DEFAULT_BASE;
  try {
    localStorage.setItem(BASE_KEY, next);
  } catch {
    /* ignore quota */
  }
  version++;
  listeners.forEach((fn) => fn());
}
