import "server-only";
import { getForecastInput } from "@/lib/forecast-input-store";
import { compareScenario, runForecast, toForecastInput, type ScenarioComparison } from "@/lib/forecast";
import { getAdjustments, getScenario } from "@/lib/scenario-store";
import type { ReportingCurrency } from "@/lib/currency";

export type AccountScenarioComparison = {
  account: { id: string; name: string; currency: ReportingCurrency };
  comparison: ScenarioComparison;
};

// One scenario against one account's base forecast, from the session-checked stores through the adapter and the
// engine. A scenario belongs to the workspace and a forecast to one account, so adjustments for other accounts'
// events (and events settled since) come back in `comparison.skipped`, not as an error. A scenario or account the
// caller does not own gives null, like a missing one. Nothing is written.
export async function getScenarioComparison(
  token: string | undefined,
  input: { scenarioId: unknown; accountId: unknown; startDate: string; endDate: string },
): Promise<AccountScenarioComparison | null> {
  const scenario = await getScenario(token, input.scenarioId);
  if (!scenario) return null;
  const stored = await getForecastInput(token, { accountId: input.accountId, startDate: input.startDate, endDate: input.endDate });
  if (!stored) return null;

  const engineInput = toForecastInput(stored);
  const baseForecast = runForecast(engineInput);
  const adjustments = await getAdjustments(token, scenario.id);
  return {
    account: stored.account,
    comparison: compareScenario({
      scenarioId: scenario.id,
      adjustments,
      baseEvents: engineInput.events,
      baseForecast,
      startDate: stored.startDate,
      endDate: stored.endDate,
      currency: engineInput.currency,
    }),
  };
}
