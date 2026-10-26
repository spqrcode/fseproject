// Dates for a cash event that repeats monthly, quarterly or annually. FinTwin stores every occurrence as its own
// ordinary event, so a repeat always has an end: a number of occurrences or an end date, and at most
// MAX_OCCURRENCES. The first date is the one entered; every later one keeps the same day of the month. A day a
// month does not have (the 29th to 31st, or 29 February) moves to that month's last day, and the following
// occurrence goes back to the original day: 31 Jan, 30 Apr, 31 Jul for a quarterly repeat. Plain calendar
// arithmetic on YYYY-MM-DD strings in UTC, so no time zone can shift a day. Callers validate the inputs.
export const REPEAT_STEP_MONTHS = { monthly: 1, quarterly: 3, annually: 12 } as const;
export type RepeatFrequency = keyof typeof REPEAT_STEP_MONTHS;
export const MAX_OCCURRENCES = 60;

function occurrence(year: number, month: number, day: number, index: number, stepMonths: number): string {
  const monthIndex = month - 1 + index * stepMonths;
  const y = year + Math.floor(monthIndex / 12);
  const m = monthIndex % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

// Exactly `count` dates.
export function recurringDates(start: string, stepMonths: number, count: number): string[] {
  const [year, month, day] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => occurrence(year, month, day, index, stepMonths));
}

// Every date up to and including `until`, but never more than `limit` dates, so an end date far in the future
// cannot produce an unbounded list. A result longer than MAX_OCCURRENCES tells the caller the end is too late.
export function recurringDatesUntil(start: string, stepMonths: number, until: string, limit = MAX_OCCURRENCES + 1): string[] {
  const [year, month, day] = start.split("-").map(Number);
  const dates: string[] = [];
  for (let index = 0; dates.length < limit; index += 1) {
    const date = occurrence(year, month, day, index, stepMonths);
    if (date > until) break;
    dates.push(date);
  }
  return dates;
}
