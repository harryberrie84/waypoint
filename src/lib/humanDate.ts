// Parse a human phrase into a date. Pure and dependency-free so it's testable and
// usable in cells and a slash command alike. Returns the resolved value in the
// app's local format ('YYYY-MM-DD', or 'YYYY-MM-DDTHH:mm' when a time was given),
// or null when the phrase isn't understood. Examples: "today", "tomorrow",
// "next friday", "in 3 weeks", "fri 9am", "end of month", "25 dec".

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function format(d: Date, hasTime: boolean): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return hasTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export interface HumanDate {
  iso: string;
  hasTime: boolean;
}

export function parseHumanDate(input: string, now: number): HumanDate | null {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;

  // Pull a time off the end / anywhere: "9am", "9:30 pm", "at 14:00".
  let h = -1;
  let mi = 0;
  const tm = /\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(s) ?? /\b(?:at )?(\d{1,2}):(\d{2})\b/.exec(s);
  if (tm) {
    h = Number(tm[1]);
    mi = tm[2] ? Number(tm[2]) : 0;
    const ap = tm[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h <= 23 && mi <= 59) s = s.replace(tm[0], '').trim();
    else h = -1;
  }
  const hasTime = h >= 0;

  // Tolerate run-together input ("nextfriday", "in3weeks", "endofmonth") so it
  // works even where the slash menu strips spaces. No-ops on already-spaced text.
  s = s
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/^(next|this|in)([a-z])/, '$1 $2')
    .replace(/(end|start|beginning)of/, '$1 of')
    .replace(/of(month|week)/, 'of $1')
    .replace(/\s+/g, ' ')
    .trim();

  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  let result: Date | null = null;

  if (!s || s === 'today' || s === 'now') {
    result = base;
  } else if (s === 'tomorrow' || s === 'tmrw') {
    base.setDate(base.getDate() + 1);
    result = base;
  } else if (s === 'yesterday') {
    base.setDate(base.getDate() - 1);
    result = base;
  } else if (s === 'next week') {
    base.setDate(base.getDate() + 7);
    result = base;
  } else if (s === 'next month') {
    base.setMonth(base.getMonth() + 1);
    result = base;
  } else if (s === 'end of month' || s === 'eom') {
    result = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  } else if (s === 'start of month' || s === 'beginning of month' || s === 'first of the month') {
    result = new Date(base.getFullYear(), base.getMonth(), 1);
  } else {
    // in N days/weeks/months/years (the "in" is optional)
    const rel = /^(?:in )?(\d+)\s*(day|days|week|weeks|month|months|year|years)$/.exec(s);
    const wd = /^(next |this )?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)$/.exec(s);
    // "25 dec" or "dec 25" or "25 december 2027"
    const dm = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(s) ?? /^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/.exec(s);

    if (rel) {
      const n = Number(rel[1]);
      const u = rel[2];
      if (u.startsWith('day')) base.setDate(base.getDate() + n);
      else if (u.startsWith('week')) base.setDate(base.getDate() + n * 7);
      else if (u.startsWith('month')) base.setMonth(base.getMonth() + n);
      else base.setFullYear(base.getFullYear() + n);
      result = base;
    } else if (wd) {
      const target = WEEKDAYS[wd[2]];
      let days = (target - base.getDay() + 7) % 7;
      if (wd[1]?.trim() === 'next') days = days === 0 ? 7 : days + 7;
      base.setDate(base.getDate() + days);
      result = base;
    } else if (dm) {
      const dayFirst = /^\d/.test(s);
      const dayNum = Number(dayFirst ? dm[1] : dm[2]);
      const monName = dayFirst ? dm[2] : dm[1];
      const mon = MONTHS[monName];
      if (mon !== undefined && dayNum >= 1 && dayNum <= 31) {
        const year = dm[3] ? Number(dm[3]) : base.getFullYear();
        const d = new Date(year, mon, dayNum);
        // No explicit year and the date already passed this year -> next year.
        if (!dm[3] && d.getTime() < base.getTime()) d.setFullYear(year + 1);
        result = d;
      }
    }
  }

  if (!result) return null;
  if (hasTime) result.setHours(h, mi, 0, 0);
  else result.setHours(0, 0, 0, 0);
  return { iso: format(result, hasTime), hasTime };
}

/** A short readable rendering of a resolved value, for inserting into a doc. */
export function humanDateLabel(value: HumanDate): string {
  const [datePart, timePart] = value.iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const dt = new Date(y, m - 1, d, timePart ? Number(timePart.slice(0, 2)) : 0, timePart ? Number(timePart.slice(3)) : 0);
  const date = dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return value.hasTime ? `${date}, ${dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : date;
}
