/**
 * Express a forecast input in the reporting currency.
 *
 * Pure TypeScript: no database or network dependency. The caller supplies the
 * rate (a persisted ECB snapshot or a cross-rate derived from two of them).
 *
 * Rules:
 *  - The opening balance and every event amount are converted with the same
 *    single rate, so the converted forecast is the base forecast scaled by
 *    that rate, never a mix of rates.
 *  - Amounts are Decimal strings and are not rounded here; rounding happens
 *    only where an amount is displayed.
 *  - The workspace danger threshold is already an amount in the reporting
 *    currency (decision 2 of 2026-10-08), so it is passed through unchanged.
 *    Before this conversion it was applied to the account's own currency.
 *  - A missing rate is an error. A rate is never invented or hard-coded.
 */

import { decimalString, parseDecimal } from "@/lib/forecast/decimal";
import type { CashEvent } from "@/lib/forecast/cash-event";
import type { ForecastInput } from "@/lib/forecast/forecast-engine";
import { convertMoney, FxRateError, type FxRate } from "@/lib/forecast/fx";
import { money, parseCurrency, type Currency } from "@/lib/forecast/money";

export function convertForecastInput(
  input: ForecastInput,
  target: Currency,
  rate: FxRate | null,
): ForecastInput {
  const targetCurrency = parseCurrency(target);
  if (input.currency === targetCurrency) return input;
  if (!rate) {
    throw new FxRateError(`Missing FX rate for ${input.currency}/${targetCurrency}.`);
  }
  const convert = (amount: string, from: Currency) =>
    convertMoney(money(amount, from), targetCurrency, rate).amount;

  const events = input.events.map<CashEvent>((event) =>
    Object.freeze({
      ...event,
      amount: convert(event.amount, event.currency),
      currency: targetCurrency,
    }),
  );

  return Object.freeze({
    ...input,
    openingBalance: convert(input.openingBalance, input.currency),
    events: Object.freeze(events),
    currency: targetCurrency,
  });
}

/** The factor that was applied, for display: 1 unit of `from` is worth this many units of `to`. */
export function appliedFactor(rate: FxRate, from: Currency): string {
  const ratio = parseDecimal(rate.rate);
  return decimalString(rate.base === from ? ratio : parseDecimal("1").dividedBy(ratio));
}
