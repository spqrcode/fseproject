import "server-only";
import { getForecastInput, type ForecastEventInput } from "@/lib/forecast-input-store";
import type { ForecastResult } from "@/lib/forecast";
import { forecastStoredInReportingCurrency, type ReportingForecast } from "@/lib/forecast-reporting";
import { liveEcbProvider, type EcbProvider } from "@/lib/fx/ecb-provider";
import type { ReportingCurrency } from "@/lib/currency";

export type LiquidityForecast = {
  account: { id: string; name: string; currency: ReportingCurrency };
  startingBalance: string;
  // Expected events dated before the start date, which the forecast counts on the start date. `amount` is in the
  // reporting currency when a rate was available, otherwise in the account's own currency.
  overdue: ForecastEventInput[];
  eventCount: number;
  conversion: ReportingForecast["conversion"];
  // Null when no usable exchange rate exists: no number is shown rather than one in the wrong currency.
  result: ForecastResult | null;
};

// One account's forecast in the reporting currency, from the session-checked store through the pure adapter, the
// conversion with a persisted ECB rate, and the engine. Ownership is enforced by getForecastInput, which reaches
// the account from the session token: a foreign, unknown or malformed id gives null here, exactly like a missing one.
export async function getLiquidityForecast(
  token: string | undefined,
  input: { accountId: unknown; startDate: string; endDate: string },
  reporting: ReportingCurrency,
  provider: EcbProvider = liveEcbProvider,
): Promise<LiquidityForecast | null> {
  const stored = await getForecastInput(token, input);
  if (!stored) return null;
  const reported = await forecastStoredInReportingCurrency(stored, reporting, provider);
  const converted = reported.available ? new Map(reported.input.events.map(event => [event.id, event.amount])) : null;
  return {
    account: stored.account,
    startingBalance: stored.startingBalance,
    overdue: stored.events.filter(event => event.overdue).map(event => ({ ...event, amount: converted?.get(event.id) ?? event.amount })),
    eventCount: stored.events.length,
    conversion: reported.conversion,
    result: reported.available ? reported.result : null,
  };
}
