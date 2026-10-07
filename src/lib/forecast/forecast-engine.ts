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
  events: readonly CashEvent[];
  currency: Currency;
}>;

/** Warning is triggered after available cash falls below 50% of opening balance. */
export const DANGER_THRESHOLD_PERCENT = "50";

export type ForecastResult = Readonly<{
  /** One end-of-day balance for every date in the inclusive forecast range. */
  timeline: readonly ForecastPoint[];
  openingBalance: string;
  closingBalance: string;
  /** Includes the balance before startDate events are applied. */
  minimumBalance: string;
  /** First date on which the minimum was observed. */
  minimumDate: string;
  dangerThresholdPercent: string;
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
  | "openingBalance";

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

function validateOpeningBalance(value: string, currency: Currency) {
  const opening = money(value, currency);
  if (parseDecimal(opening.amount).isNegative()) {
    throw new ForecastInputError(
      "openingBalance",
      "Must be non-negative when the danger threshold is a percentage of opening balance.",
    );
  }
  return opening;
}

function compareEvents(left: CashEvent, right: CashEvent) {
  if (left.expectedDate !== right.expectedDate) {
    return left.expectedDate < right.expectedDate ? -1 : 1;
  }
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  const leftIsExpense = parseDecimal(left.amount).isNegative();
  const rightIsExpense = parseDecimal(right.amount).isNegative();
  if (leftIsExpense !== rightIsExpense) return leftIsExpense ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
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

  const currency = parseCurrency(input.currency);
  const opening = validateOpeningBalance(input.openingBalance, currency);
  const thresholdPercent = parseDecimal(DANGER_THRESHOLD_PERCENT);
  const thresholdAmount = money(
    decimalString(parseDecimal(opening.amount).times(thresholdPercent).dividedBy(100)),
    currency,
  );

  const eligibleEvents = input.events
    .map((event) => parseCashEvent(event))
    .filter(
      (event) =>
        event.status === "pending" &&
        event.expectedDate >= startDate &&
        event.expectedDate <= endDate,
    );

  for (const event of eligibleEvents) {
    if (event.currency !== currency) {
      throw new CurrencyMismatchError(event.currency, currency);
    }
  }
  eligibleEvents.sort(compareEvents);

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
      eligibleEvents[eventIndex].expectedDate === date
    ) {
      running = addMoney(
        running,
        money(eligibleEvents[eventIndex].amount, eligibleEvents[eventIndex].currency),
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
    dangerThresholdPercent: decimalString(thresholdPercent),
    dangerThresholdAmount: thresholdAmount.amount,
    firstDangerDate,
    runwayDays,
    currency,
  });
}
