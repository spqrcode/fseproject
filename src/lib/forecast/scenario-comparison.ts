/**
 * Base versus scenario comparison for one forecast.
 *
 * Pure TypeScript: no database or network dependency. The caller supplies the
 * base events, the base forecast and the scenario's adjustments; this module
 * runs the scenario, reports what was skipped, and splits the difference in
 * closing balance into one contribution per applied adjustment.
 *
 * Rule (proposal US-05, US-12 in requirements.md): the displayed difference equals the sum of the contributions.
 * It holds because the closing balance is the opening balance plus the sum of
 * the events dated inside the forecast range, so it is additive across events
 * and each event has at most one adjustment per scenario. compareScenario
 * checks the equality and throws if it fails, rather than showing a breakdown
 * that does not add up.
 *
 * For amounts as stored (two decimals) the equality is exact. After conversion
 * into the reporting currency an amount carries the engine's 40 significant
 * digits, so a sum can round in its last digit and two ways of adding the same
 * numbers can differ around the 34th decimal. The check therefore accepts a
 * difference of at most CONTRIBUTION_TOLERANCE, eight orders of magnitude below
 * one cent: it still catches a missing or double-counted invoice.
 */

import { decimalString, parseDecimal } from "@/lib/forecast/decimal";
import type { CashEvent } from "@/lib/forecast/cash-event";
import type { ForecastResult } from "@/lib/forecast/forecast-engine";
import type { Currency } from "@/lib/forecast/money";
import {
  partitionAdjustments,
  runScenarioForecast,
  type DelayAdjustment,
  type SkippedAdjustment,
} from "@/lib/forecast/scenario";

export type AdjustmentContribution = Readonly<{
  adjustmentId: string;
  cashEventId: string;
  /** Closing balance with only this adjustment applied, minus the base closing balance. */
  closingDelta: string;
}>;

export type ScenarioComparison = Readonly<{
  scenarioId: string;
  base: ForecastResult;
  scenario: ForecastResult;
  /** scenario closing balance minus base closing balance. */
  closingDelta: string;
  /** scenario lowest balance minus base lowest balance. */
  minimumDelta: string;
  contributions: readonly AdjustmentContribution[];
  /** Sum of the contributions; always equal to closingDelta. */
  contributionsTotal: string;
  skipped: readonly SkippedAdjustment[];
}>;

/** Largest accepted gap between the difference and the sum of contributions. */
export const CONTRIBUTION_TOLERANCE = "0.0000000001";

export function contributionsAddUp(contributionsTotal: string, closingDelta: string): boolean {
  return parseDecimal(contributionsTotal).minus(parseDecimal(closingDelta)).abs()
    .lessThanOrEqualTo(parseDecimal(CONTRIBUTION_TOLERANCE));
}

export class ContributionMismatchError extends Error {
  constructor(readonly closingDelta: string, readonly contributionsTotal: string) {
    super(`Scenario contributions (${contributionsTotal}) do not add up to the closing balance difference (${closingDelta}).`);
  }
}

export function compareScenario(params: {
  scenarioId: string;
  adjustments: readonly DelayAdjustment[];
  baseEvents: readonly CashEvent[];
  baseForecast: ForecastResult;
  startDate: string;
  endDate: string;
  currency: Currency;
}): ScenarioComparison {
  const { scenarioId, adjustments, baseEvents, baseForecast, startDate, endDate, currency } = params;
  const run = (list: readonly DelayAdjustment[]) =>
    runScenarioForecast({ scenarioId, adjustments: list, baseEvents, baseForecast, startDate, endDate, currency });

  const whole = run(adjustments);
  const { applicable } = partitionAdjustments(adjustments, baseEvents);

  const contributions = applicable.map((adjustment) =>
    Object.freeze({
      adjustmentId: adjustment.id,
      cashEventId: adjustment.cashEventId,
      closingDelta: run([adjustment]).contributionDelta,
    }),
  );

  const total = contributions.reduce((sum, item) => sum.plus(parseDecimal(item.closingDelta)), parseDecimal("0"));
  const contributionsTotal = decimalString(total);
  if (!contributionsAddUp(contributionsTotal, whole.contributionDelta)) {
    throw new ContributionMismatchError(whole.contributionDelta, contributionsTotal);
  }

  return Object.freeze({
    scenarioId,
    base: baseForecast,
    scenario: whole.result,
    closingDelta: whole.contributionDelta,
    minimumDelta: decimalString(parseDecimal(whole.result.minimumBalance).minus(parseDecimal(baseForecast.minimumBalance))),
    contributions: Object.freeze(contributions),
    contributionsTotal,
    skipped: whole.skipped,
  });
}
