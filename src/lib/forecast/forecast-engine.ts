/**
 * Pure forecast engine.
 *
 * Converts a list of CashEvents (all in the same currency) into a
 * daily balance timeline and derives summary metrics.
 *
 * Financial rules:
 *  - Events on the startDate ARE included.
 *  - Events outside [startDate, endDate] are excluded (not an error).
 *  - Multiple events on the same date are summed; the daily balance is
 *    recorded once per day (after all same-day events).
 *  - Events are processed in ascending expectedDate order; within a date
 *    they are processed in ascending creation order (id is used as a
 *    tiebreaker so ordering is deterministic).
 *  - The opening balance is the startingBalance argument.
 *  - Currency mixing is not attempted; callers must convert first.
 *  - All arithmetic uses Decimal; results are plain decimal strings.
 *
 * This module has no database, network, authentication, or UI dependency.
 */

import { parseDecimal, decimalString } from "@/lib/forecast/decimal";
import { money, type Currency, type Money } from "@/lib/forecast/money";
import type { CashEvent } from "@/lib/forecast/cash-event";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Balance at the end of one calendar day. */
export type ForecastPoint = Readonly<{
  date: string;        // YYYY-MM-DD
  balance: string;     // signed decimal string in the reporting currency
}>;

export type ForecastResult = Readonly<{
  /** Balance at every day that had at least one event (plus startDate if provided). */
  timeline: readonly ForecastPoint[];
  /**
   * Starting balance of the forecast range, i.e. openingBalance argument value.
   * Stored here so callers can compute deltas between scenarios without re-running.
   */
  openingBalance: string;
  /**
   * Balance after all events in the horizon have been applied.
   * Equals openingBalance when no events fall within [startDate, endDate].
   */
  closingBalance: string;
  /** Minimum balance reached at any point in the timeline. */
  minimumBalance: string;
  /** Date on which minimumBalance was first reached. null when timeline is empty. */
  minimumDate: string | null;
  /** Reporting currency. */
  currency: Currency;
}>;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface ForecastInput {
  /** Inclusive start date. Events on this date are included. YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end date. YYYY-MM-DD. */
  endDate: string;
  /** Balance before any event in the horizon is applied. */
  openingBalance: string;
  /** All events to consider. Events outside the date range are silently skipped. */
  events: readonly CashEvent[];
  /** The reporting currency.  All events must already be in this currency. */
  currency: Currency;
}

/**
 * Run the base forecast.  The input events are never mutated; a new
 * ForecastResult is returned.
 */
export function runForecast(input: ForecastInput): ForecastResult {
  const { startDate, endDate, currency } = input;

  // Filter to events inside [startDate, endDate].
  const inRange = input.events
    .filter((e) => e.expectedDate >= startDate && e.expectedDate <= endDate && e.currency === currency)
    .slice()
    // Primary: date ascending; secondary: id ascending (deterministic tiebreak)
    .sort((a, b) =>
      a.expectedDate < b.expectedDate
        ? -1
        : a.expectedDate > b.expectedDate
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );

  const openingMoney: Money = money(input.openingBalance, currency);
  const timeline: ForecastPoint[] = [];

  let running: Money = openingMoney;
  let minBalance: string = input.openingBalance;
  let minDate: string | null = null;

  // Group by date and accumulate.
  let i = 0;
  while (i < inRange.length) {
    const date = inRange[i].expectedDate;
    let dayTotal: Money = money("0", currency);
    let j = i;
    while (j < inRange.length && inRange[j].expectedDate === date) {
      // amount is signed: positive = income, negative = expense
      const current = parseDecimal(dayTotal.amount).plus(parseDecimal(inRange[j].amount));
      dayTotal = money(decimalString(current), currency);
      j++;
    }
    // Apply day total to running balance
    const newBalance = parseDecimal(running.amount).plus(parseDecimal(dayTotal.amount));
    running = money(decimalString(newBalance), currency);

    timeline.push(Object.freeze({ date, balance: running.amount }));

    // Track minimum
    if (parseDecimal(running.amount).lessThan(parseDecimal(minBalance))) {
      minBalance = running.amount;
      minDate = date;
    }
    i = j;
  }

  return Object.freeze({
    timeline: Object.freeze(timeline),
    openingBalance: openingMoney.amount,
    closingBalance: running.amount,
    minimumBalance: minBalance,
    minimumDate: minDate,
    currency,
  });
}

/**
 * Compute the delta between a scenario result and the base result.
 * Returns the difference in closing balance: scenarioResult - baseResult.
 */
export function scenarioContribution(
  base: ForecastResult,
  scenario: ForecastResult,
): string {
  const diff = parseDecimal(scenario.closingBalance).minus(parseDecimal(base.closingBalance));
  return decimalString(diff);
}

