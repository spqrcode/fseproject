/**
 * Scenario application — delayed-invoice isolation.
 *
 * Financial rules:
 *  - A scenario adjustment holds a date override for one CashEvent.
 *  - The original CashEvent is NEVER mutated.
 *  - The original CashEvent's persisted row is NEVER changed.
 *  - The base forecast result is NEVER changed.
 *  - The adjustment produces a new in-memory event projection with the
 *    overridden date; the original event is excluded on its original date
 *    and re-included on the overridden date.
 *  - An adjustment that cannot apply to a forecast must not break the whole
 *    scenario, and must not disappear silently either. applyDelayAdjustment
 *    stays strict (it throws for an adjustment that is not active or whose
 *    event is not in the list). runScenarioForecast first partitions the
 *    adjustments with partitionAdjustments and applies only the applicable
 *    ones; every skipped adjustment is returned with a reason so the caller
 *    can say so. The reasons are:
 *      invalid         - marked invalid by business validation;
 *      not_applicable  - its event is no longer expected (received, paid or
 *                        cancelled), so it is no longer a forecast event;
 *      not_in_forecast - its event is not in this forecast's event list, for
 *                        example because it belongs to another account.
 *
 * This module is pure TypeScript with no database or network dependency.
 */

import { parseDecimal, decimalString } from "@/lib/forecast/decimal";
import type { CashEvent } from "@/lib/forecast/cash-event";
import type { ForecastResult } from "@/lib/forecast/forecast-engine";
import { runForecast } from "@/lib/forecast/forecast-engine";
import type { Currency } from "@/lib/forecast/money";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * A scenario adjustment that moves one cash event to a different date.
 * Stored in scenario_adjustments; fetched from the DB and decoded here.
 */
export type DelayAdjustment = Readonly<{
  /** UUID of the scenario_adjustments row. */
  id: string;
  /** UUID of the parent scenario. */
  scenarioId: string;
  /** UUID of the target CashEvent.  The original event is not modified. */
  cashEventId: string;
  /** YYYY-MM-DD override date to project the event onto. */
  dateOverride: string;
  /**
   * 'active': can be applied. 'invalid': marked unusable. 'not_applicable':
   * active in the database, but its event is no longer expected (derived when
   * the adjustments are loaded). Only 'active' adjustments are applied.
   */
  status: "active" | "invalid" | "not_applicable";
}>;

export type SkippedAdjustment = Readonly<{
  adjustmentId: string;
  cashEventId: string;
  reason: "invalid" | "not_applicable" | "not_in_forecast";
}>;

/** The resolved projection of a scenario against the base forecast. */
export type ScenarioProjection = Readonly<{
  scenarioId: string;
  /** The scenario forecast result (identical interface to the base result). */
  result: ForecastResult;
  /**
   * Difference in closing balance: scenarioClosing - baseClosing.
   * Positive means the scenario ends with more cash.
   */
  contributionDelta: string;
  /** Adjustments that were not applied to this forecast, each with its reason. */
  skipped: readonly SkippedAdjustment[];
}>;

export function scenarioContribution(base: ForecastResult, scenario: ForecastResult): string {
  if (base.currency !== scenario.currency) {
    throw new Error("Cannot compare forecasts in different currencies.");
  }
  return decimalString(parseDecimal(scenario.closingBalance).minus(parseDecimal(base.closingBalance)));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InvalidAdjustmentError extends Error {
  constructor(readonly adjustmentId: string) {
    super(
      `ScenarioAdjustment ${adjustmentId} is invalid: its target CashEvent has been deleted or is inaccessible.`,
    );
  }
}

export class MissingEventError extends Error {
  constructor(readonly cashEventId: string) {
    super(
      `CashEvent ${cashEventId} is referenced by a scenario adjustment but was not found in the supplied event list.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Which adjustments apply to a forecast
// ---------------------------------------------------------------------------

/**
 * Split adjustments into those that can be applied to `events` and those that
 * cannot, with the reason. Pure: it neither throws nor changes its input.
 * A scenario belongs to a workspace while a forecast belongs to one account,
 * and an event can be settled after an adjustment was saved, so some
 * adjustments legitimately do not apply to a given forecast.
 */
export function partitionAdjustments(
  adjustments: readonly DelayAdjustment[],
  events: readonly CashEvent[],
): { applicable: readonly DelayAdjustment[]; skipped: readonly SkippedAdjustment[] } {
  const ids = new Set(events.map((event) => event.id));
  const applicable: DelayAdjustment[] = [];
  const skipped: SkippedAdjustment[] = [];
  for (const adjustment of adjustments) {
    const skip = (reason: SkippedAdjustment["reason"]) =>
      skipped.push(Object.freeze({ adjustmentId: adjustment.id, cashEventId: adjustment.cashEventId, reason }));
    if (adjustment.status === "invalid") skip("invalid");
    else if (adjustment.status === "not_applicable") skip("not_applicable");
    else if (!ids.has(adjustment.cashEventId)) skip("not_in_forecast");
    else applicable.push(adjustment);
  }
  return Object.freeze({ applicable: Object.freeze(applicable), skipped: Object.freeze(skipped) });
}

// ---------------------------------------------------------------------------
// Immutable projection
// ---------------------------------------------------------------------------

/**
 * Build a new event list for a scenario by replacing the expected date of
 * the adjusted event.  The original `events` array and its elements are
 * never mutated.
 *
 * Strict: throws InvalidAdjustmentError when adjustment.status is not
 * 'active' and MissingEventError when the referenced event is not in
 * `events`. Use partitionAdjustments (as runScenarioForecast does) to decide
 * which adjustments to apply to a given forecast.
 */
export function applyDelayAdjustment(
  adjustment: DelayAdjustment,
  events: readonly CashEvent[],
): readonly CashEvent[] {
  if (adjustment.status !== "active") {
    throw new InvalidAdjustmentError(adjustment.id);
  }

  const targetIndex = events.findIndex((e) => e.id === adjustment.cashEventId);
  if (targetIndex === -1) {
    throw new MissingEventError(adjustment.cashEventId);
  }

  // Produce a new array where only the target event has an updated date.
  // The original object is not mutated — a new frozen object is created.
  return events.map((e, i) => {
    if (i !== targetIndex) return e;
    return Object.freeze<CashEvent>({
      ...e,
      expectedDate: adjustment.dateOverride,
    });
  });
}

/**
 * Apply multiple delay adjustments in sequence and run a forecast over
 * the resulting event list.  Each adjustment is applied independently to
 * the *original* event list, not cumulatively, so two adjustments to the
 * same event use the last adjustment's date.
 *
 * Adjustments that do not apply to this forecast are skipped and reported in
 * `skipped`; they never make the scenario fail.
 *
 * Implementation note: when the same event is adjusted by more than one
 * adjustment in the list, the last one wins.  In practice the database
 * UNIQUE(scenario_id, cash_event_id) constraint prevents this from
 * occurring, but the function remains safe regardless.
 */
export function runScenarioForecast(params: {
  scenarioId: string;
  adjustments: readonly DelayAdjustment[];
  baseEvents: readonly CashEvent[];
  baseForecast: ForecastResult;
  startDate: string;
  endDate: string;
  currency: Currency;
}): ScenarioProjection {
  const { scenarioId, adjustments, baseEvents, baseForecast } = params;

  // Apply all adjustments to a working copy of the event list.
  // Each adjustment.applyDelayAdjustment returns a new array; none mutate.
  const { applicable, skipped } = partitionAdjustments(adjustments, baseEvents);
  let scenarioEvents: readonly CashEvent[] = baseEvents;
  for (const adjustment of applicable) {
    scenarioEvents = applyDelayAdjustment(adjustment, scenarioEvents);
  }

  const result = runForecast({
    startDate: params.startDate,
    endDate: params.endDate,
    openingBalance: baseForecast.openingBalance,
    dangerThreshold: baseForecast.dangerThresholdPercent === null
      ? baseForecast.dangerThresholdAmount
      : null,
    events: scenarioEvents,
    currency: params.currency,
  });

  const delta = scenarioContribution(baseForecast, result);

  return Object.freeze({
    scenarioId,
    result,
    contributionDelta: delta,
    skipped,
  });
}
