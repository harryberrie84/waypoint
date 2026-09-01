// Swedish public holidays ("roda dagar") and working-day counting, on the same
// day-index model the formula engine uses (whole days since the epoch, UTC). Used
// by the workdays / daysoff / holiday formula functions so a table can compute how
// many working days, and how many complete days off, lie between two dates.

const DAY_MS = 86400000;

function idx(year: number, month1: number, day: number): number {
  return Math.floor(Date.UTC(year, month1 - 1, day) / DAY_MS);
}
function dow(dayIdx: number): number {
  return new Date(Math.round(dayIdx) * DAY_MS).getUTCDay(); // 0 = Sunday, 6 = Saturday
}

// Easter Sunday as [month, day] (Anonymous Gregorian algorithm).
function easter(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

// The first Saturday in the inclusive [from, from+span] window starting on a date.
function firstSaturday(startIdx: number, span: number): number {
  for (let i = 0; i <= span; i++) if (dow(startIdx + i) === 6) return startIdx + i;
  return startIdx;
}

const cache = new Map<number, Set<number>>();

// The set of public-holiday day-indices for a year. Sundays are red too but are
// handled by the weekday check, so they are not listed here.
export function swedishHolidays(year: number): Set<number> {
  const hit = cache.get(year);
  if (hit) return hit;
  const set = new Set<number>([
    idx(year, 1, 1), // Nyarsdagen
    idx(year, 1, 6), // Trettondedag jul
    idx(year, 5, 1), // Forsta maj
    idx(year, 6, 6), // Nationaldagen
    idx(year, 12, 25), // Juldagen
    idx(year, 12, 26), // Annandag jul
  ]);
  const [em, ed] = easter(year);
  const e = idx(year, em, ed);
  set.add(e - 2); // Langfredag
  set.add(e); // Paskdagen
  set.add(e + 1); // Annandag pask
  set.add(e + 39); // Kristi himmelsfards dag
  set.add(e + 49); // Pingstdagen
  set.add(firstSaturday(idx(year, 6, 20), 6)); // Midsommardagen (Sat, Jun 20-26)
  set.add(firstSaturday(idx(year, 10, 31), 6)); // Alla helgons dag (Sat, Oct 31 - Nov 6)
  cache.set(year, set);
  return set;
}

export function isHoliday(dayIdx: number): boolean {
  const d = Math.round(dayIdx);
  return swedishHolidays(new Date(d * DAY_MS).getUTCFullYear()).has(d);
}

// A working day: Monday to Friday and not a public holiday.
export function isWorkday(dayIdx: number): boolean {
  const w = dow(dayIdx);
  if (w === 0 || w === 6) return false;
  return !isHoliday(dayIdx);
}

// Counts over the half-open range (min, max], so workdays + daysoff == total days
// and "from today to the deadline" excludes today and includes the deadline.
export function countWorkdays(a: number, b: number): number {
  const lo = Math.round(Math.min(a, b));
  const hi = Math.round(Math.max(a, b));
  let n = 0;
  for (let d = lo + 1; d <= hi; d++) if (isWorkday(d)) n++;
  return n;
}

export function countDaysOff(a: number, b: number): number {
  const lo = Math.round(Math.min(a, b));
  const hi = Math.round(Math.max(a, b));
  return hi - lo - countWorkdays(lo, hi);
}
