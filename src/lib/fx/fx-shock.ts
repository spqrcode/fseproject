/**
 * Pure domain logic for percentage-based FX shock scenarios.
 *
 * Financial rules:
 *  - An FX shock references a persisted FxRateSnapshot.
 *  - shockPercent is stored as a Decimal-compatible plain string.
 *  - shockedRate = sourceRate × (1 + shockPercent / 100).
 *  - A positive shock means one unit of BASE buys more QUOTE.
 *  - A negative shock means one unit of BASE buys less QUOTE.
 *  - The shocked rate must always remain strictly greater than zero.
 *  - A shock of -100% or lower is invalid and rejected.
 *  - No JavaScript floating-point arithmetic is used (uses ForecastDecimal).
 *  - No rounding is performed during internal calculations.
 *  - Both sourceRate and shockedRate are returned.
 *  - Source snapshot ID, effective date, provider, and source state are preserved.
 *  - Clearly labelled as hypothetical.
 *  - Re-evaluating the same adjustment against the same snapshot produces the exact same result.
 *  - Inverse conversion uses the reciprocal of the shocked rate, not a separately shocked inverse rate.
 *  - If snapshot is missing or unusable (rejected / non-positive), an explicit error state is returned.
 *
 * This module has NO database, network, or UI dependencies.
 */

import { parseDecimal, decimalString, DecimalInputError } from "@/lib/forecast/decimal";
import { fxRate, convertMoney, type FxRate } from "@/lib/forecast/fx";
import type { Currency, Money } from "@/lib/forecast/money";
import { parseCurrency } from "@/lib/forecast/money";
import type { FxSnapshot, SnapshotState } from "@/lib/fx/snapshot-store";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class InvalidShockPercentageError extends Error {
  constructor(readonly value: unknown, message?: string) {
    super(
      message ??
        `Invalid shock percentage ${JSON.stringify(value)}: must be a plain decimal strictly greater than -100%.`,
    );
    this.name = "InvalidShockPercentageError";
  }
}

export class MissingSnapshotError extends Error {
  constructor(readonly snapshotId?: string) {
    super(
      snapshotId
        ? `Referenced FX snapshot ${snapshotId} was not found.`
        : "Referenced FX snapshot was not found or is missing.",
    );
    this.name = "MissingSnapshotError";
  }
}

export class UnusableSnapshotError extends Error {
  constructor(readonly reason: string, readonly snapshotId?: string) {
    super(
      snapshotId
        ? `FX snapshot ${snapshotId} is unusable: ${reason}.`
        : `FX snapshot is unusable: ${reason}.`,
    );
    this.name = "UnusableSnapshotError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resolved evaluated FX shock result. */
export type EvaluatedFxShock = Readonly<{
  /** ID of the underlying persisted snapshot. */
  sourceSnapshotId: string;
  /** Provider that originally fetched the rate (e.g. 'ecb'). */
  provider: string;
  /** ISO 4217 base currency (e.g. 'EUR'). */
  baseCurrency: Currency;
  /** ISO 4217 quote currency (e.g. 'USD' or 'SGD'). */
  quoteCurrency: Currency;
  /** ECB effective date (TIME_PERIOD) of the source rate. */
  effectiveDate: string;
  /** Original unshocked rate as a decimal string. */
  sourceRate: string;
  /** Percentage applied to the rate. */
  shockPercent: string;
  /** Resulting shocked rate as a full-precision decimal string. */
  shockedRate: string;
  /** State of the underlying snapshot (must be 'accepted'). */
  sourceState: SnapshotState;
  /** Explicitly identifies the rate as a scenario shock. */
  isHypothetical: true;
  /** User-facing label. */
  label: "hypothetical";
  /** FxRate object constructed from the shocked rate, usable with convertMoney. */
  shockedFxRate: FxRate;
  /**
   * Reciprocal of the shocked rate: 1 / shockedRate.
   * Inverse conversion must use this reciprocal rather than a separately shocked rate.
   */
  reciprocalRate: string;
}>;

// ---------------------------------------------------------------------------
// Calculation functions
// ---------------------------------------------------------------------------

/**
 * Validate and compute the shocked rate:
 *   shockedRate = sourceRate × (1 + shockPercent / 100)
 *
 * Rules:
 *  - shockPercent must be a finite plain decimal strictly > -100.
 *  - sourceRate must be a finite plain decimal > 0.
 *  - All calculations use ForecastDecimal.
 *  - No intermediate rounding is performed.
 */
export function calculateShockedRate(sourceRate: string, shockPercent: string): string {
  // Validate shockPercent
  let shockDec;
  try {
    shockDec = parseDecimal(shockPercent);
  } catch (err) {
    if (err instanceof DecimalInputError) {
      throw new InvalidShockPercentageError(shockPercent);
    }
    throw err;
  }

  // Shock of -100% or lower would produce zero or negative rate
  if (shockDec.lessThanOrEqualTo(-100)) {
    throw new InvalidShockPercentageError(
      shockPercent,
      `Shock percentage ${JSON.stringify(shockPercent)} is invalid: shock must be strictly greater than -100%.`,
    );
  }

  // Validate sourceRate
  let sourceDec;
  try {
    sourceDec = parseDecimal(sourceRate);
  } catch (err) {
    if (err instanceof DecimalInputError) {
      throw new UnusableSnapshotError(`invalid source rate ${JSON.stringify(sourceRate)}`);
    }
    throw err;
  }

  if (!sourceDec.greaterThan(0)) {
    throw new UnusableSnapshotError(`source rate must be greater than zero, got ${JSON.stringify(sourceRate)}`);
  }

  // factor = 1 + (shockPercent / 100)
  const factor = parseDecimal("1").plus(shockDec.dividedBy(parseDecimal("100")));
  const shockedDec = sourceDec.times(factor);

  if (!shockedDec.greaterThan(0)) {
    throw new InvalidShockPercentageError(
      shockPercent,
      `Calculated shocked rate must be strictly greater than zero, got ${decimalString(shockedDec)}.`,
    );
  }

  return decimalString(shockedDec);
}

/**
 * Evaluate an FX shock against a persisted snapshot.
 *
 * Pure function: does not modify the snapshot and does not make network calls.
 *
 * Throws MissingSnapshotError if snapshot is null or undefined.
 * Throws UnusableSnapshotError if snapshot state is not 'accepted' or rate is invalid.
 * Throws InvalidShockPercentageError if shockPercent <= -100 or malformed.
 */
export function evaluateFxShock(
  snapshot: FxSnapshot | null | undefined,
  shockPercent: string,
): EvaluatedFxShock {
  if (!snapshot) {
    throw new MissingSnapshotError();
  }

  if (snapshot.state !== "accepted") {
    throw new UnusableSnapshotError(
      `snapshot state is "${snapshot.state}"`,
      snapshot.id,
    );
  }

  const baseCurrency = parseCurrency(snapshot.baseCurrency);
  const quoteCurrency = parseCurrency(snapshot.quoteCurrency);

  const shockedRate = calculateShockedRate(snapshot.rate, shockPercent);
  const shockedFxRate = fxRate(baseCurrency, quoteCurrency, shockedRate);

  // Reciprocal = 1 / shockedRate
  const reciprocalRate = decimalString(parseDecimal("1").dividedBy(parseDecimal(shockedRate)));

  return Object.freeze({
    sourceSnapshotId: snapshot.id,
    provider: snapshot.provider,
    baseCurrency,
    quoteCurrency,
    effectiveDate: snapshot.effectiveDate,
    sourceRate: snapshot.rate,
    shockPercent: decimalString(parseDecimal(shockPercent)),
    shockedRate,
    sourceState: snapshot.state,
    isHypothetical: true,
    label: "hypothetical",
    shockedFxRate,
    reciprocalRate,
  });
}

/**
 * Convert money using an evaluated FX shock.
 *
 * Direct conversion (base -> quote):
 *   amount × shockedRate
 *
 * Inverse conversion (quote -> base):
 *   Uses the reciprocal (amount / shockedRate or amount × reciprocalRate),
 *   guaranteeing consistency without applying a separate shock.
 */
export function convertWithShock(
  amount: Money,
  targetCurrency: Currency,
  shock: EvaluatedFxShock,
): Money {
  return convertMoney(amount, targetCurrency, shock.shockedFxRate);
}
