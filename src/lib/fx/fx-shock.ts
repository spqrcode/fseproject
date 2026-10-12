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
 *  - Source snapshot IDs, effective date, provider, and freshness are preserved.
 *  - Clearly labelled as hypothetical.
 *  - Re-evaluating the same adjustment against the same snapshot produces the exact same result.
 *  - Inverse conversion uses the reciprocal of the shocked rate, not a separately shocked inverse rate.
 *  - UNAVAILABLE results never fabricate a source or adjusted rate.
 *
 * This module has NO database, network, or UI dependencies.
 */

import { parseDecimal, decimalString, DecimalInputError } from "@/lib/forecast/decimal";
import { fxRate, convertMoney, type FxRate } from "@/lib/forecast/fx";
import type { Currency, Money } from "@/lib/forecast/money";
import { parseCurrency } from "@/lib/forecast/money";
import type { RateFailure, RateResult } from "@/lib/fx/rate-service";
import type { FxSnapshot } from "@/lib/fx/snapshot-store";

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

/** Result contract consumed by Scenario Lab. */
export type ScenarioFxResult =
  | Readonly<{
      freshness: "CURRENT" | "STALE";
      sourceRate: string;
      adjustedRate: string;
      baseCurrency: Currency;
      quoteCurrency: Currency;
      shockPercent: string;
      effectiveDate: string;
      provider: string;
      sourceSnapshotIds: readonly string[];
      refreshFailure: RateFailure | null;
      adjustedFxRate: FxRate;
      isHypothetical: true;
    }>
  | Readonly<{
      freshness: "UNAVAILABLE";
      sourceRate: null;
      adjustedRate: null;
      baseCurrency: Currency;
      quoteCurrency: Currency;
      shockPercent: string;
      effectiveDate: null;
      provider: string;
      sourceSnapshotIds: readonly [];
      failure: RateFailure;
      adjustedFxRate: null;
      isHypothetical: true;
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
 * Throws UnusableSnapshotError if the persisted rate is invalid.
 * Throws InvalidShockPercentageError if shockPercent <= -100 or malformed.
 */
export function evaluateFxShock(
  snapshot: FxSnapshot | null | undefined,
  shockPercent: string,
): EvaluatedFxShock {
  if (!snapshot) {
    throw new MissingSnapshotError();
  }

  const baseCurrency = parseCurrency(snapshot.baseCurrency);
  const quoteCurrency = parseCurrency(snapshot.quoteCurrency);

  const sourceRate = decimalString(parseDecimal(snapshot.rate));
  const shockedRate = calculateShockedRate(sourceRate, shockPercent);
  const shockedFxRate = fxRate(baseCurrency, quoteCurrency, shockedRate);

  // Reciprocal = 1 / shockedRate
  const reciprocalRate = decimalString(parseDecimal("1").dividedBy(parseDecimal(shockedRate)));

  return Object.freeze({
    sourceSnapshotId: snapshot.id,
    provider: snapshot.provider,
    baseCurrency,
    quoteCurrency,
    effectiveDate: snapshot.effectiveDate,
    sourceRate,
    shockPercent: decimalString(parseDecimal(shockPercent)),
    shockedRate,
    isHypothetical: true,
    label: "hypothetical",
    shockedFxRate,
    reciprocalRate,
  });
}

/**
 * Apply a percentage shock to a rate already resolved by the FX service.
 * The service owns direct, reciprocal and cross-rate calculation; this
 * function never derives a currency pair or reads the clock/network.
 */
export function buildScenarioFxResult(
  rateResult: RateResult,
  currencies: Readonly<{ baseCurrency: Currency; quoteCurrency: Currency }>,
  shockPercent: string,
): ScenarioFxResult {
  const normalizedShock = decimalString(parseShockPercent(shockPercent));
  const baseCurrency = parseCurrency(currencies.baseCurrency);
  const quoteCurrency = parseCurrency(currencies.quoteCurrency);

  if (rateResult.status === "UNAVAILABLE") {
    return Object.freeze({
      freshness: "UNAVAILABLE",
      sourceRate: null,
      adjustedRate: null,
      baseCurrency,
      quoteCurrency,
      shockPercent: normalizedShock,
      effectiveDate: null,
      provider: rateResult.provider,
      sourceSnapshotIds: Object.freeze([]) as readonly [],
      failure: rateResult.failure,
      adjustedFxRate: null,
      isHypothetical: true,
    });
  }

  if (rateResult.rate.base !== baseCurrency || rateResult.rate.quote !== quoteCurrency) {
    throw new UnusableSnapshotError(
      `resolved rate ${rateResult.rate.base}/${rateResult.rate.quote} does not match requested pair ${baseCurrency}/${quoteCurrency}`,
    );
  }

  const adjustedRate = calculateShockedRate(rateResult.rate.rate, normalizedShock);
  return Object.freeze({
    freshness: rateResult.status,
    sourceRate: rateResult.rate.rate,
    adjustedRate,
    baseCurrency,
    quoteCurrency,
    shockPercent: normalizedShock,
    effectiveDate: rateResult.effectiveDate,
    provider: rateResult.provider,
    sourceSnapshotIds: Object.freeze([...rateResult.snapshotIds]),
    refreshFailure: rateResult.refreshFailure,
    adjustedFxRate: fxRate(baseCurrency, quoteCurrency, adjustedRate),
    isHypothetical: true,
  });
}

function parseShockPercent(value: string) {
  let parsed;
  try {
    parsed = parseDecimal(value);
  } catch (error) {
    if (error instanceof DecimalInputError) throw new InvalidShockPercentageError(value);
    throw error;
  }
  if (parsed.lessThanOrEqualTo(-100)) throw new InvalidShockPercentageError(value);
  return parsed;
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
