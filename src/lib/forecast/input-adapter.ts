import type { CashEvent } from "@/lib/forecast/cash-event";
import type { ForecastInput } from "@/lib/forecast/forecast-engine";
import type { Currency } from "@/lib/forecast/money";

/**
 * Database-facing event shape returned by the forecast input store.
 * Presentation metadata remains available to the caller, but is deliberately
 * not copied into the pure Forecast Engine contract.
 */
export type StoredForecastEvent = Readonly<{
  id: string;
  description: string;
  amount: string;
  expectedDate: string;
  originalDate: string;
  overdue: boolean;
  createdAt: string;
}>;

/** Database-facing input shape, independent of the store implementation. */
export type StoredForecastInput = Readonly<{
  account: Readonly<{
    id: string;
    name: string;
    currency: Currency;
  }>;
  startDate: string;
  endDate: string;
  startingBalance: string;
  dangerThreshold: string | null;
  events: readonly StoredForecastEvent[];
}>;

/**
 * Adapts validated store output to the pure Forecast Engine input.
 *
 * The store returns expected events only, so every adapted event is pending.
 * The account currency is copied onto each event; FX conversion must happen
 * before this boundary when an event needs a different reporting currency.
 */
export function toForecastInput(source: StoredForecastInput): ForecastInput {
  const events = source.events.map<CashEvent>((event) =>
    Object.freeze({
      id: event.id,
      amount: event.amount,
      currency: source.account.currency,
      expectedDate: event.expectedDate,
      createdAt: event.createdAt,
      status: "pending",
    }),
  );

  return Object.freeze({
    startDate: source.startDate,
    endDate: source.endDate,
    openingBalance: source.startingBalance,
    dangerThreshold: source.dangerThreshold,
    events: Object.freeze(events),
    currency: source.account.currency,
  });
}
