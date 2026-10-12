import { parseCashEvent, parseForecastDate, type CashEvent } from "@/lib/forecast/cash-event";
import { decimalString, parseDecimal } from "@/lib/forecast/decimal";
import {
  addMoney,
  CurrencyMismatchError,
  money,
  parseCurrency,
  type Currency,
} from "@/lib/forecast/money";

export type ForecastPoint = Readonly<{
  /** Calendar date in UTC, formatted as YYYY-MM-DD. */
  date: string;
  /** End-of-day balance in the reporting currency. */
  balance: string;
}>;

export type ForecastInput = Readonly<{
  /** Inclusive UTC calendar date. */
  startDate: string;
  /** Inclusive UTC calendar date. */
  endDate: string;
  /** Balance before events on startDate are applied. */
  openingBalance: string;
  /** Workspace amount; null selects the 50% default. */
  dangerThreshold: string | null;
  events: readonly CashEvent[];
  currency: Currency;
}>;

/** Warning is triggered after available cash falls below 50% of opening balance. */
export const DANGER_THRESHOLD_PERCENT = "50";
/** Inclusive calendar dates returned by one forecast request. */
export const MAX_FORECAST_DAYS = 366;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type ForecastResult = Readonly<{
  /** One end-of-day balance for every date in the inclusive forecast range. */
  timeline: readonly ForecastPoint[];
  openingBalance: string;
  closingBalance: string;
  /** Includes the balance before startDate events are applied. */
  minimumBalance: string;
  /** First date on which the minimum was observed. */
  minimumDate: string;
  /** The default percentage, or null when a workspace amount was supplied. */
  dangerThresholdPercent: string | null;
  dangerThresholdAmount: string;
  /** First date whose balance is strictly below the threshold. */
  firstDangerDate: string | null;
  /** Calendar days from startDate; null when the threshold is never breached. */
  runwayDays: number | null;
  currency: Currency;
}>;

type ForecastInputField =
  | "startDate"
  | "endDate"
  | "openingBalance"
  | "dangerThreshold";

export class ForecastInputError extends Error {
  constructor(
    readonly field: ForecastInputField,
    message: string,
  ) {
    super(`ForecastInput.${field}: ${message}`);
  }
}

function validateInputDate(field: "startDate" | "endDate", value: unknown) {
  try {
    return parseForecastDate("expectedDate", value);
  } catch {
    throw new ForecastInputError(field, `Expected a valid YYYY-MM-DD date, received ${JSON.stringify(value)}.`);
  }
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return (end - start) / MILLISECONDS_PER_DAY + 1;
}

function validateOpeningBalance(value: string, currency: Currency) {
  let opening;
  try {
    opening = money(value, currency);
  } catch {
    throw new ForecastInputError(
      "openingBalance",
      `Expected a plain decimal amount, received ${JSON.stringify(value)}.`,
    );
  }
  return opening;
}

function resolveDangerThreshold(value: string | null, openingBalance: string, currency: Currency) {
  if (value === null) {
    const percent = parseDecimal(DANGER_THRESHOLD_PERCENT);
    return {
      amount: money(
        decimalString(parseDecimal(openingBalance).times(percent).dividedBy(100)),
        currency,
      ),
      percent: decimalString(percent),
    };
  }

  try {
    return { amount: money(value, currency), percent: null };
  } catch {
    throw new ForecastInputError(
      "dangerThreshold",
      `Expected a plain decimal amount or null, received ${JSON.stringify(value)}.`,
    );
  }
}

type ProjectedEvent = Readonly<{
  event: CashEvent;
  forecastDate: string;
}>;

function compareProjectedEvents(left: ProjectedEvent, right: ProjectedEvent) {
  if (left.forecastDate !== right.forecastDate) {
    return left.forecastDate < right.forecastDate ? -1 : 1;
  }
  if (left.event.createdAt !== right.event.createdAt) {
    return left.event.createdAt < right.event.createdAt ? -1 : 1;
  }
  const leftIsExpense = parseDecimal(left.event.amount).isNegative();
  const rightIsExpense = parseDecimal(right.event.amount).isNegative();
  if (leftIsExpense !== rightIsExpense) return leftIsExpense ? -1 : 1;
  if (left.event.id === right.event.id) return 0;
  return left.event.id < right.event.id ? -1 : 1;
}

/**
 * Projects pending cash events without mutating caller input.
 * Completed and cancelled events never affect a forecast.
 */
export function runForecast(input: ForecastInput): ForecastResult {
  const startDate = validateInputDate("startDate", input.startDate);
  const endDate = validateInputDate("endDate", input.endDate);
  if (startDate > endDate) {
    throw new ForecastInputError("endDate", "Must be on or after startDate.");
  }
  if (inclusiveDays(startDate, endDate) > MAX_FORECAST_DAYS) {
    throw new ForecastInputError(
      "endDate",
      `Forecast range must contain at most ${MAX_FORECAST_DAYS} calendar days.`,
    );
  }

  const currency = parseCurrency(input.currency);
  const opening = validateOpeningBalance(input.openingBalance, currency);
  const threshold = resolveDangerThreshold(input.dangerThreshold, opening.amount, currency);
  const thresholdAmount = threshold.amount;

  const eligibleEvents = input.events
    .map((event) => parseCashEvent(event))
    .filter(
      (event) =>
        event.status === "pending" &&
        event.expectedDate <= endDate,
    )
    .map((event) => ({
      event,
      forecastDate: event.expectedDate < startDate ? startDate : event.expectedDate,
    }));

  for (const { event } of eligibleEvents) {
    if (event.currency !== currency) {
      throw new CurrencyMismatchError(event.currency, currency);
    }
  }
  eligibleEvents.sort(compareProjectedEvents);

  const timeline: ForecastPoint[] = [];
  let running = opening;
  let minimum = opening;
  let minimumDate = startDate;
  let firstDangerDate: string | null = null;
  let runwayDays: number | null = null;
  let eventIndex = 0;
  let elapsedDays = 0;

  for (let date = startDate; ; date = nextDate(date)) {
    while (
      eventIndex < eligibleEvents.length &&
      eligibleEvents[eventIndex].forecastDate === date
    ) {
      const event = eligibleEvents[eventIndex].event;
      running = addMoney(
        running,
        money(event.amount, event.currency),
      );
      eventIndex += 1;
    }

    timeline.push(Object.freeze({ date, balance: running.amount }));

    if (parseDecimal(running.amount).lessThan(parseDecimal(minimum.amount))) {
      minimum = running;
      minimumDate = date;
    }

    if (
      firstDangerDate === null &&
      parseDecimal(running.amount).lessThan(parseDecimal(thresholdAmount.amount))
    ) {
      firstDangerDate = date;
      runwayDays = elapsedDays;
    }

    if (date === endDate) break;
    elapsedDays += 1;
  }

  return Object.freeze({
    timeline: Object.freeze(timeline),
    openingBalance: opening.amount,
    closingBalance: running.amount,
    minimumBalance: minimum.amount,
    minimumDate,
    dangerThresholdPercent: threshold.percent,
    dangerThresholdAmount: thresholdAmount.amount,
    firstDangerDate,
    runwayDays,
    currency,
  });
}
