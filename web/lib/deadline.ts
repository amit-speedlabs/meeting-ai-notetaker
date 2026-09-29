/**
 * Deterministic deadline resolution. The LLM only returns the verbatim phrase; this module converts
 * it to a calendar date relative to the meeting date. Ambiguous phrases keep their text and get no date.
 * Pure functions, no server-only imports (unit tested).
 */

export type ResolvedDeadline = { date: string | null; text: string };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_SHORT: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14 };

export const NOT_SPECIFIED = 'Not specified';

/** meetingDate: 'YYYY-MM-DD' (the meeting's local date). */
export function resolveDeadline(phrase: string | null | undefined, meetingDate: string): ResolvedDeadline {
  const raw = (phrase || '').trim();
  if (!raw || /^(none|n\/?a|not specified|unspecified|no deadline)$/i.test(raw)) return { date: null, text: NOT_SPECIFIED };
  const base = parseISODate(meetingDate);
  const p = raw.toLowerCase().replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ');

  const out = (d: Date | null) => ({ date: d ? fmt(d) : null, text: raw });

  // Explicitly ambiguous / relative-to-unknown-event phrases: keep text, no date.
  if (/(next meeting|next call|next sync|next review|asap|as soon as|soon|later|sometime|eventually|when possible|at some point|in a bit|shortly)/.test(p)) return out(null);

  if (/\b(day after tomorrow)\b/.test(p)) return out(addDays(base, 2));
  if (/\b(tomorrow|tmrw|tmr)\b/.test(p)) return out(addDays(base, 1));
  if (/\b(today|tonight|end of (the )?day|eod|by \d{1,2}(:\d{2})? ?(am|pm)|this (morning|afternoon|evening))\b/.test(p)) return out(base);
  if (/\byesterday\b/.test(p)) return out(null);

  // in N days / weeks
  let m = p.match(/\b(?:in|within) (\d+|a|an|one|two|three|four|five|six|seven|ten|fourteen) (day|days|week|weeks)\b/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUMBER_WORDS[m[1]];
    return out(addDays(base, m[2].startsWith('week') ? n * 7 : n));
  }

  if (/\b(end of (the )?month|month[- ]end|month end|eom)\b/.test(p)) return out(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)));
  if (/\b(end of next month)\b/.test(p)) return out(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 2, 0)));
  if (/\b(end of (the |this )?week|eow|this week)\b/.test(p)) return out(weekdayOnOrAfter(base, 5));
  if (/\b(end of next week)\b/.test(p)) return out(addDays(startOfNextWeek(base), 4));
  if (/\bnext week\b/.test(p)) return out(startOfNextWeek(base));
  if (/\bnext month\b/.test(p)) return out(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1)));

  // Weekday names
  const wd = findWeekday(p);
  if (wd !== null) {
    if (/\bnext\b/.test(p)) {
      // "next Friday" → the Friday in the following calendar week (original wording is preserved alongside).
      return out(addDays(startOfNextWeek(base), (wd + 6) % 7));
    }
    return out(weekdayOnOrAfter(base, wd));
  }

  // Explicit dates: "29 September", "Sept 29", "29th Sep 2026", "2026-09-29"
  m = p.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return out(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  m = p.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]{3,9})\.?(?: (\d{4}))?\b/);
  if (m && MONTHS[m[2]] !== undefined) return out(explicitDate(base, +m[1], MONTHS[m[2]], m[3]));
  m = p.match(/\b([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/);
  if (m && MONTHS[m[1]] !== undefined) return out(explicitDate(base, +m[2], MONTHS[m[1]], m[3]));
  // Numeric d/m: only when unambiguous (day > 12). Otherwise keep the text.
  m = p.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) return out(explicitDate(base, a, b - 1, m[3]));
    if (b > 12 && a <= 12) return out(explicitDate(base, b, a - 1, m[3]));
    return out(null);
  }
  return out(null);
}

function findWeekday(p: string): number | null {
  for (let i = 0; i < 7; i++) if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(p)) return i;
  for (const [k, v] of Object.entries(WD_SHORT)) if (new RegExp(`\\b${k}\\b`).test(p)) return v;
  return null;
}

function explicitDate(base: Date, day: number, month: number, year?: string) {
  let y = year ? (year.length === 2 ? 2000 + +year : +year) : base.getUTCFullYear();
  let d = new Date(Date.UTC(y, month, day));
  if (!year && d < base) d = new Date(Date.UTC(y + 1, month, day)); // "5 Jan" said in Sept → next year
  if (d.getUTCDate() !== day) return null; // invalid like 31 Feb
  return d;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400_000);
}
function weekdayOnOrAfter(d: Date, wd: number) {
  return addDays(d, (wd - d.getUTCDay() + 7) % 7);
}
function startOfNextWeek(d: Date) {
  // Weeks start on Monday.
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return addDays(d, 7 - dow);
}

/** Local calendar date of an instant in a given IANA timezone. */
export function localDate(at: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
