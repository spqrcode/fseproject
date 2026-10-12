import "server-only";
import { getForecastInput, type ForecastEventInput } from "@/lib/forecast-input-store";
import { runForecast, toForecastInput, type ForecastResult } from "@/lib/forecast";
import type { ReportingCurrency } from "@/lib/currency";

export type LiquidityForecast = {
  account: { id: string; name: string; currency: ReportingCurrency };
  startingBalance: string;
  // Expected events dated before the start date, which the forecast counts on the start date.
  overdue: ForecastEventInput[];
  eventCount: number;
  result: ForecastResult;
};

// One account's forecast, from the session-checked store through the pure adapter into the engine.
// Ownership is enforced by getForecastInput, which reaches the account from the session token: a foreign,
// unknown or malformed id gives null here, exactly like a missing one. The amounts stay in the account's
// own currency because FX conversion into the reporting currency is not connected yet; nothing is converted.
export async function getLiquidityForecast(
  token: string | undefined,
  input: { accountId: unknown; startDate: string; endDate: string },
): Promise<LiquidityForecast | null> {
  const stored = await getForecastInput(token, input);
  if (!stored) return null;
  return {
    account: stored.account,
    startingBalance: stored.startingBalance,
    overdue: stored.events.filter(event => event.overdue),
    eventCount: stored.events.length,
    result: runForecast(toForecastInput(stored)),
  };
}
