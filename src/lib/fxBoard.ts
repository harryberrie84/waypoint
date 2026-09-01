import { parseLocaleNumber } from './number';

// Pure logic behind the currency board: the /currency widget and the Currency
// page tab share it. Conversion is INJECTED (the same shape the formula engine takes
// its FxResolve), so nothing here needs a rate cache, a network or localStorage,
// which is what keeps it testable.

export interface FxRow {
  id: string;
  code: string; // the ISO code this row converts INTO
  note: string; // free label: "hotel quote", "airport kiosk"
  manual: number | null; // pinned rate, units of `code` per 1 base; null = use the live one
}

export interface FxBoardData {
  title: string;
  amount: number; // the amount, held in `base`
  base: string; // the currency the amount is in
  rows: FxRow[];
}

/** What a row comes to once the rates are applied. */
export interface FxLine {
  row: FxRow; // code normalised
  rate: number | null; // units of row.code per 1 base, null when nothing knows it
  value: number | null; // the amount converted, null when the rate is unknown
  drift: number | null; // a pinned rate against the live one, signed (0.06 = 6% more per unit)
}

export type Converter = (amount: number, from: string, to: string, manual?: number) => number;

export function normalizeCode(raw: string): string {
  return (raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
}

/** Parse a typed amount, tolerating "1 234,50" and "1,234.50" alike (the rule the
 *  number cells already use). Null for anything that isn't a number. */
export function parseAmount(raw: string): number | null {
  const n = parseLocaleNumber(raw);
  return Number.isFinite(n) ? n : null;
}

const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

/** Three rows to start with, minus whichever one is already the base. Ids are
 *  derived from the code rather than generated, since a pure module has no clock
 *  and no rng to build one from. */
export function defaultFxBoard(base: string): FxBoardData {
  const b = normalizeCode(base) || 'USD';
  const starter = ['JPY', 'EUR', 'USD'].filter((c) => c !== b);
  return {
    title: '',
    amount: 1000,
    base: b,
    rows: starter.map((code) => ({ id: `fx-${code.toLowerCase()}`, code, note: '', manual: null })),
  };
}

/** Resolve every row against the rate table. A pinned row uses its own rate AND
 *  reports how far that sits from the live one, which is the point of pinning: you
 *  want to see that the kiosk is 6% off, not just accept its number. */
export function buildLines(data: FxBoardData, convert: Converter): FxLine[] {
  const base = normalizeCode(data.base);
  const amount = Number.isFinite(data.amount) ? data.amount : 0;
  return (data.rows ?? []).map((row) => {
    const code = normalizeCode(row.code);
    const live = finite(convert(1, base, code));
    const pinned = typeof row.manual === 'number' && Number.isFinite(row.manual) && row.manual > 0;
    const rate = pinned ? (row.manual as number) : live;
    return {
      row: { ...row, code },
      rate,
      value: rate === null ? null : finite(amount * rate),
      drift: pinned && live !== null && live !== 0 ? ((row.manual as number) - live) / live : null,
    };
  });
}

/** Make `code` the base and demote the old base to a row, keeping the amount
 *  worth what it was worth a moment ago. Swapping SEK->JPY on 1000 kr should read
 *  14 000 yen, not 1000 yen. Returns the data unchanged if the rate is unknown.
 *
 *  A PINNED rate is quoted per 1 base, so it has to be restated in the new base
 *  as well. Carrying "13.16 JPY per SEK" across a swap to EUR would read as
 *  "1 EUR = 13.16 JPY", a rate nobody was ever quoted, and the drift chip would
 *  then announce -92% against the day's rate. Restating keeps both the number and
 *  the spread the user recorded. If the step cannot be resolved the pin is
 *  dropped rather than left meaning something else. */
export function swapBase(data: FxBoardData, code: string, convert: Converter): FxBoardData {
  const from = normalizeCode(data.base);
  const to = normalizeCode(code);
  if (!to || to === from) return data;
  const moved = finite(convert(data.amount, from, to));
  if (moved === null) return data;
  const step = finite(convert(1, from, to)); // new base per 1 old base
  const restate = (r: FxRow): FxRow => {
    if (typeof r.manual !== 'number' || !Number.isFinite(r.manual)) return r;
    return { ...r, manual: step ? Math.round((r.manual / step) * 10000) / 10000 : null };
  };
  const rows = data.rows.filter((r) => normalizeCode(r.code) !== to).map(restate);
  if (from && !rows.some((r) => normalizeCode(r.code) === from)) {
    rows.unshift({ id: `fx-${from.toLowerCase()}`, code: from, note: '', manual: null });
  }
  return { ...data, base: to, amount: Math.round(moved * 100) / 100, rows };
}

// Codes worth offering in the picker, in the order a Swedish base and a Japanese
// trip would want them. Anything the rate table knows can still be typed in.
export const COMMON_CODES = [
  'SEK', 'JPY', 'EUR', 'USD', 'GBP', 'NOK', 'DKK', 'CHF', 'PLN', 'CZK',
  'THB', 'KRW', 'TWD', 'SGD', 'HKD', 'CNY', 'AUD', 'CAD', 'NZD', 'ISK',
];

const NAMES: Record<string, string> = {
  SEK: 'Swedish krona', JPY: 'Japanese yen', EUR: 'Euro', USD: 'US dollar',
  GBP: 'Pound sterling', NOK: 'Norwegian krone', DKK: 'Danish krone', CHF: 'Swiss franc',
  PLN: 'Polish złoty', CZK: 'Czech koruna', THB: 'Thai baht', KRW: 'South Korean won',
  TWD: 'Taiwan dollar', SGD: 'Singapore dollar', HKD: 'Hong Kong dollar', CNY: 'Chinese yuan',
  AUD: 'Australian dollar', CAD: 'Canadian dollar', NZD: 'New Zealand dollar', ISK: 'Icelandic króna',
};

export function currencyName(code: string): string {
  return NAMES[normalizeCode(code)] ?? '';
}

// Currencies that are quoted whole. Showing "¥168 240.00" is wrong in a way a
// Japanese price tag never is.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'ISK', 'HUF', 'CLP', 'VND', 'TWD']);
const PREFIX: Record<string, string> = { JPY: '¥', CNY: '¥', EUR: '€', USD: '$', AUD: '$', CAD: '$', NZD: '$', HKD: '$', SGD: '$', TWD: 'NT$', GBP: '£', KRW: '₩', THB: '฿' };
const SUFFIX: Record<string, string> = { SEK: 'kr', NOK: 'kr', DKK: 'kr', ISK: 'kr', PLN: 'zł', CZK: 'Kč', CHF: 'Fr' };

/** Format money the way the number columns do: grouped, symbol where there is a
 *  familiar one, and no decimals on the currencies nobody writes decimals for. */
export function formatAmount(value: number | null, code: string): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const c = normalizeCode(code);
  const whole = ZERO_DECIMAL.has(c);
  const digits = whole ? 0 : 2;
  const text = value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (PREFIX[c]) return PREFIX[c] + text;
  if (SUFFIX[c]) return `${text} ${SUFFIX[c]}`;
  return `${text} ${c}`;
}

// A bare toLocaleString() caps at three fraction digits, which quietly turns a
// rate of 0.071429 into "0.071". Rates are the one number here where the tail
// matters, so the digits are always passed explicitly.
function rateText(n: number): string {
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** "1 SEK = 14.0231 JPY". Small rates get more decimals, or a strong-to-weak pair
 *  collapses to a useless "0.09". */
export function formatRate(rate: number | null, base: string, code: string): string {
  if (rate === null || !Number.isFinite(rate)) return 'no rate yet';
  return `1 ${normalizeCode(base)} = ${rateText(rate)} ${normalizeCode(code)}`;
}

/** The other direction, which is the one you need holding a price tag: what one
 *  unit of the row's currency costs in the base. */
export function formatInverse(rate: number | null, base: string, code: string): string {
  if (rate === null || !Number.isFinite(rate) || rate === 0) return '';
  return `1 ${normalizeCode(code)} = ${rateText(1 / rate)} ${normalizeCode(base)}`;
}

/** How old the cached rates are, in words. Deliberately coarse: the free upstream
 *  publishes about once a day, so "3 minutes ago" would imply a precision that
 *  isn't there. */
export function describeAge(fetchedAt: number, now: number): string {
  if (!fetchedAt) return 'no rates yet';
  const mins = Math.max(0, Math.round((now - fetchedAt) / 60000));
  if (mins < 2) return 'updated just now';
  if (mins < 60) return `updated ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `updated ${hours} h ago`;
  const days = Math.round(hours / 24);
  return `updated ${days} day${days === 1 ? '' : 's'} ago`;
}
