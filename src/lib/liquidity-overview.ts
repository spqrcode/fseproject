// Pure presentation helpers for the Liquidity overview: the forecast window chosen from the page's
// query string and the coordinates of the balance chart. No database, session or engine access here,
// so every rule is unit-tested on its own.

// Horizons offered on the page, in inclusive calendar days. 365 stays inside the engine's 366-day limit.
export const HORIZONS = [30, 90, 180, 365] as const;
export type Horizon = (typeof HORIZONS)[number];
export const DEFAULT_HORIZON: Horizon = 90;

// Anything that is not exactly one of the offered values falls back to the default rather than erroring,
// because the value comes from a URL a person can edit.
export function parseHorizon(value: unknown): Horizon {
  const text = Array.isArray(value) ? value[0] : value;
  return HORIZONS.find(horizon => String(horizon) === text) ?? DEFAULT_HORIZON;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The forecast starts on today's UTC date, the same calendar the store and the engine use, and covers
// `days` dates counting both ends.
export function forecastWindow(today: Date, days: Horizon): { startDate: string; endDate: string } {
  const startDate = today.toISOString().slice(0, 10);
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return { startDate, endDate: end.toISOString().slice(0, 10) };
}

// The first value of a query parameter, or undefined. Next.js gives repeated parameters as arrays.
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type ChartPoint = Readonly<{ date: string; balance: string }>;
export type ChartGeometry = Readonly<{
  width: number;
  height: number;
  path: string;
  thresholdY: number;
  zeroY: number | null;
  minimum: Readonly<{ x: number; y: number }>;
  dangerX: number | null;
  top: number;
  bottom: number;
}>;

// Chart coordinates only. Converting decimal strings to binary floating point is acceptable here because
// a pixel position needs no cent precision; every amount shown as text is formatted from the exact string.
export type ChartForecast = Readonly<{
  timeline: readonly ChartPoint[];
  dangerThresholdAmount: string;
  // The engine's minimum also counts the balance before the start date's events, so it may be lower than
  // every timeline point; the marker is drawn at that value on the minimum date.
  minimumBalance: string;
  minimumDate: string;
  firstDangerDate: string | null;
}>;
export function chartGeometry(
  { timeline, dangerThresholdAmount, minimumBalance, minimumDate, firstDangerDate }: ChartForecast,
  size: { width: number; height: number; padding: number } = { width: 640, height: 240, padding: 16 },
): ChartGeometry {
  if (timeline.length === 0) throw new RangeError("A forecast timeline has at least one date.");
  for (const point of timeline) if (!DATE.test(point.date)) throw new RangeError(`Not a date: ${point.date}`);
  const balances = timeline.map(point => Number(point.balance));
  const thresholdValue = Number(dangerThresholdAmount);
  const minimumValue = Number(minimumBalance);
  if (![...balances, thresholdValue, minimumValue].every(Number.isFinite)) throw new RangeError("Balances must be finite decimals.");

  let low = Math.min(...balances, thresholdValue, minimumValue);
  let high = Math.max(...balances, thresholdValue, minimumValue);
  if (low === high) { low -= 1; high += 1; }
  const { width, height, padding } = size;
  const plotHeight = height - padding * 2;
  const y = (value: number) => round(padding + (high - value) / (high - low) * plotHeight);
  // A single-date forecast is drawn as a flat line across the whole width.
  const step = timeline.length > 1 ? width / (timeline.length - 1) : 0;
  const x = (index: number) => round(timeline.length > 1 ? index * step : 0);

  const points = timeline.length > 1
    ? balances.map((value, index) => `${x(index)},${y(value)}`)
    : [`0,${y(balances[0])}`, `${width},${y(balances[0])}`];
  // A step line: the balance holds all day and changes at the next date, as an end-of-day series does.
  const path = points.reduce((d, point, index) => {
    if (index === 0) return `M${point}`;
    const [px, py] = point.split(",");
    return `${d} H${px} V${py}`;
  }, "");

  const indexOf = (date: string) => timeline.findIndex(point => point.date === date);
  const minimumIndex = Math.max(0, indexOf(minimumDate));
  const dangerIndex = firstDangerDate === null ? -1 : indexOf(firstDangerDate);
  return Object.freeze({
    width, height, path,
    thresholdY: y(thresholdValue),
    zeroY: low < 0 && high > 0 ? y(0) : null,
    minimum: Object.freeze({ x: x(minimumIndex), y: y(minimumValue) }),
    dangerX: dangerIndex < 0 ? null : x(dangerIndex),
    top: high,
    bottom: low,
  });
}

const round = (value: number) => Math.round(value * 100) / 100;
