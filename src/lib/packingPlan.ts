// ---------------------------------------------------------------------------
// packingPlan, a first-draft packing list from the trip you already planned.
// ---------------------------------------------------------------------------
// Reads what the page knows (how many days, which months, the forecast for the
// place, whether the itinerary mentions a pool or a hike) and proposes a list you
// then edit. Deliberately a DRAFT: it suggests, it never ticks anything and it
// never removes what you added yourself.
//
// Pure and injected: the caller passes the trip facts and the forecast, so this
// tests without a network and without a clock.

import type { ChecklistItem } from './checklistIO';
import type { DayWeather } from './weather';

export interface TripFacts {
  /** How many days the trip covers (from the page's dated rows). 0 = unknown. */
  days: number;
  /** Event titles from the itinerary, used to spot activities worth packing for. */
  titles: string[];
  /** Daily forecast for the destination, if the page has a place to ask about. */
  forecast: DayWeather[];
}

/** An activity we can recognise from an itinerary line, and what it needs. */
const ACTIVITIES: { match: RegExp; items: string[] }[] = [
  { match: /\b(pool|swim|beach|onsen|sento|bath)\b/i, items: ['Swimwear', 'Quick-dry towel'] },
  { match: /\b(hike|hiking|trail|mountain|climb|trek)\b/i, items: ['Walking shoes', 'Daypack', 'Blister plasters'] },
  { match: /\b(run|running|gym|jog)\b/i, items: ['Running kit'] },
  { match: /\b(dinner|restaurant|reservation|omakase|ceremony|wedding|theatre|opera)\b/i, items: ['One smart outfit'] },
  { match: /\b(ski|snowboard|snow)\b/i, items: ['Gloves', 'Thermal layer'] },
  { match: /\b(flight|fly|airport|plane)\b/i, items: ['Passport', 'Boarding passes', 'Neck pillow'] },
  { match: /\b(train|shinkansen|rail)\b/i, items: ['Rail pass'] },
  { match: /\b(temple|shrine|museum|tour|walking)\b/i, items: ['Comfortable shoes'] },
  { match: /\b(camp|camping|tent)\b/i, items: ['Head torch', 'Power bank'] },
  { match: /\b(bike|cycle|cycling)\b/i, items: ['Padded shorts'] },
];

// Always worth having, whatever the trip is.
const ESSENTIALS = ['Phone charger', 'Toothbrush', 'Medication', 'Wallet and cards'];

/** Clothing scales with the trip, but stops: nobody packs 30 t-shirts. */
function clothingFor(days: number): string[] {
  if (days <= 0) return ['T-shirts', 'Underwear', 'Socks'];
  const tops = Math.min(days + 1, 10);
  const under = Math.min(days + 2, 12);
  return [`T-shirts x${tops}`, `Underwear x${under}`, `Socks x${under}`, days > 4 ? 'Laundry pouch' : ''].filter(Boolean);
}

/** What the forecast implies. Only speaks when it has numbers to speak from. */
function weatherFor(forecast: DayWeather[]): string[] {
  if (!forecast.length) return [];
  const out: string[] = [];
  const hi = Math.max(...forecast.map((d) => d.hi));
  const lo = Math.min(...forecast.map((d) => d.lo));
  // `precip` is optional; a forecast without it should not read as "no rain".
  const wettest = forecast.reduce((m, d) => Math.max(m, d.precip ?? 0), 0);
  if (wettest >= 30) out.push('Umbrella or rain jacket');
  if (hi >= 25) out.push('Sun cream', 'Sunglasses', 'Hat');
  if (lo <= 5) out.push('Warm coat', 'Hat and gloves');
  else if (lo <= 12) out.push('Light jacket');
  if (hi - lo >= 12) out.push('Layers (the days swing a lot)');
  return out;
}

/**
 * Suggest a packing list. `existing` is what the widget already holds; anything
 * already on it (case-insensitively, ignoring a trailing count) is left alone, so
 * running this twice does not double the list and never disturbs your own edits.
 */
export function suggestPacking(facts: TripFacts, existing: ChecklistItem[] = []): string[] {
  const seen = new Set(existing.map((i) => normalise(i.text)));
  const out: string[] = [];
  const push = (item: string) => {
    const key = normalise(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  ESSENTIALS.forEach(push);
  clothingFor(facts.days).forEach(push);
  weatherFor(facts.forecast).forEach(push);

  const blob = facts.titles.join(' \n ');
  for (const a of ACTIVITIES) {
    if (a.match.test(blob)) a.items.forEach(push);
  }
  return out;
}

/** "T-shirts x7" and "t-shirts" are the same thing for de-duplication. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*x\s*\d+\s*$/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}
