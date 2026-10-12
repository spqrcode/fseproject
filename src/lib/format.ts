// Presentation formatting shared by every page. Amounts arrive as decimal strings (as PostgreSQL
// numeric values do) and are never converted to binary floating point, so large or very precise
// values are displayed exactly and rounding happens only here, at the presentation boundary.
// The locale and time zone are fixed so the server and the browser render identical text.
const LOCALE = "en-GB";
const DECIMAL = /^-?\d+(\.\d+)?$/;
// The forecast engine keeps 40 significant digits, so an unrounded converted amount can be a little
// longer than 40 characters. The cap only stops absurd input, not real results.
const MAX_DECIMAL_LENGTH = 100;
// Half to even, the rule the forecast engine uses when it rounds (decimal.js ROUND_HALF_EVEN), so a
// displayed amount never differs by a cent from the same amount rounded in a calculation.
const ROUNDING = "halfEven";
export const UNAVAILABLE = "Unavailable";

function decimal(value: string): string {
  if (value.length > MAX_DECIMAL_LENGTH || !DECIMAL.test(value)) throw new RangeError(`Not a plain decimal: ${JSON.stringify(value)}`);
  return value;
}
// Intl accepts exact decimal strings at runtime, but the TypeScript library still types format() as number-only.
type DecimalFormatter = { format(value: string): string };
function formatter(options: Intl.NumberFormatOptions): DecimalFormatter {
  return new Intl.NumberFormat(LOCALE, options) as unknown as DecimalFormatter;
}

type SignOption = { signed?: boolean };
// "negative" never prints a sign on a value that rounds to zero, so -0.001 EUR shows as €0.00, not -€0.00.
const sign = (options: SignOption) => options.signed ? "exceptZero" : "negative";

export function formatMoney(value: string | null | undefined, currency: string, options: SignOption = {}): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError(`Not an ISO 4217 currency code: ${JSON.stringify(currency)}`);
  return formatter({ style: "currency", currency, signDisplay: sign(options), roundingMode: ROUNDING }).format(decimal(value));
}

// A ratio of 0.1234 is shown as 12.34%. A missing ratio (for example a zero denominator) is unavailable, never NaN.
export function formatPercent(ratio: string | null | undefined, options: SignOption = {}): string {
  if (ratio === null || ratio === undefined) return UNAVAILABLE;
  return formatter({ style: "percent", maximumFractionDigits: 2, signDisplay: sign(options), roundingMode: ROUNDING }).format(decimal(ratio));
}

const calendarDate = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
// A calendar date such as a forecast day (YYYY-MM-DD) is read as a UTC date, so it never shifts by a day.
export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Not a calendar date: ${JSON.stringify(value)}`);
  }
  return calendarDate.format(date);
}

const timestamp = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC",
});
// Observation times are shown in UTC and labelled as such, because the viewer's time zone is unknown on the server.
export function formatTimestamp(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a valid timestamp: ${JSON.stringify(value)}`);
  return `${timestamp.format(date)} UTC`;
}

// An exchange rate as ECB publishes it: four decimals, half to even, without grouping. A rate that would round
// to zero at four decimals keeps four significant digits instead, so a small rate is never shown as 0.0000.
// The exact value stays available to callers, for example in a <data value> attribute.
export function formatRate(value: string | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  const exact = decimal(value);
  const small = /^-?0\.00/.test(exact);
  const options: Intl.NumberFormatOptions = small
    ? { maximumSignificantDigits: 4, useGrouping: false, roundingMode: ROUNDING }
    : { minimumFractionDigits: 4, maximumFractionDigits: 4, useGrouping: false, roundingMode: ROUNDING };
  return formatter(options).format(exact);
}
