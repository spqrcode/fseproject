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
 *  - If an adjustment references a deleted or inaccessible event,
 *    its status is 'invalid' and applyDelayAdjustment throws
 *    InvalidAdjustmentError rather than silently ignoring the override.
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
  /** 'active' | 'invalid'.  Callers must check this before applying. */
  status: "active" | "invalid";
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
}>;

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
// Immutable projection
// ---------------------------------------------------------------------------

/**
 * Build a new event list for a scenario by replacing the expected date of
 * the adjusted event.  The original `events` array and its elements are
 * never mutated.
 *
 * Throws InvalidAdjustmentError when adjustment.status is 'invalid'.
 * Throws MissingEventError when the referenced event is not in `events`.
 */
export function applyDelayAdjustment(
  adjustment: DelayAdjustment,
  events: readonly CashEvent[],
): readonly CashEvent[] {
  if (adjustment.status === "invalid") {
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
  let scenarioEvents: readonly CashEvent[] = baseEvents;
  for (const adjustment of adjustments) {
    scenarioEvents = applyDelayAdjustment(adjustment, scenarioEvents);
  }

  const result = runForecast({
    startDate: params.startDate,
    endDate: params.endDate,
    openingBalance: baseForecast.openingBalance,
    events: scenarioEvents,
    currency: params.currency,
  });

  const delta = decimalString(
    parseDecimal(result.closingBalance).minus(parseDecimal(baseForecast.closingBalance)),
  );

  return Object.freeze({
    scenarioId,
    result,
    contributionDelta: delta,
  });
}
