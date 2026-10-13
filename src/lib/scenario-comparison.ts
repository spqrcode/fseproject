import "server-only";
import { getForecastInput } from "@/lib/forecast-input-store";
import { compareScenario, type Currency, type ScenarioComparison } from "@/lib/forecast";
import { forecastStoredInReportingCurrency, type ReportingForecast } from "@/lib/forecast-reporting";
import { liveEcbProvider, type EcbProvider } from "@/lib/fx/ecb-provider";
import { getAdjustments, getScenario } from "@/lib/scenario-store";
import type { ReportingCurrency } from "@/lib/currency";

export type AccountScenarioComparison = {
  account: { id: string; name: string; currency: ReportingCurrency };
  conversion: ReportingForecast["conversion"];
  // Null when no usable exchange rate exists: no figure is shown rather than one in the wrong currency.
  comparison: ScenarioComparison | null;
};

// One scenario against one account's base forecast, in the reporting currency, from the session-checked stores
// through the adapter, the shared conversion (one persisted ECB rate, the same as the Liquidity overview) and the
// engine. A scenario belongs to the workspace and a forecast to one account, so adjustments for other accounts'
// events (and events settled since) come back in `comparison.skipped`, not as an error. A scenario or account the
// caller does not own gives null, like a missing one. Nothing is written.
export async function getScenarioComparison(
  token: string | undefined,
  input: { scenarioId: unknown; accountId: unknown; startDate: string; endDate: string },
  reporting: Currency,
  provider: EcbProvider = liveEcbProvider,
): Promise<AccountScenarioComparison | null> {
  const scenario = await getScenario(token, input.scenarioId);
  if (!scenario) return null;
  const stored = await getForecastInput(token, { accountId: input.accountId, startDate: input.startDate, endDate: input.endDate });
  if (!stored) return null;

  const reported = await forecastStoredInReportingCurrency(stored, reporting, provider);
  if (!reported.available) return { account: stored.account, conversion: reported.conversion, comparison: null };
  const adjustments = await getAdjustments(token, scenario.id);
  return {
    account: stored.account,
    conversion: reported.conversion,
    comparison: compareScenario({
      scenarioId: scenario.id,
      adjustments,
      baseEvents: reported.input.events,
      baseForecast: reported.result,
      startDate: stored.startDate,
      endDate: stored.endDate,
      currency: reported.input.currency,
    }),
  };
}
