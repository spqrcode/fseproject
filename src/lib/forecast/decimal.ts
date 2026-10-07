import Decimal from "decimal.js";

// Forecast calculations keep more precision than any accepted database amount.
// Rounding is explicit; constructing a Decimal never silently rounds to cents.
export const ForecastDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1_000_000_000,
  toExpPos: 1_000_000_000,
});

const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class DecimalInputError extends Error {
  constructor(readonly value: unknown) {
    super(`Expected a plain finite decimal string, received ${JSON.stringify(value)}.`);
  }
}

export function parseDecimal(value: string) {
  if (!PLAIN_DECIMAL.test(value)) throw new DecimalInputError(value);
  const parsed = new ForecastDecimal(value);
  if (!parsed.isFinite()) throw new DecimalInputError(value);
  return parsed;
}

/** Serializes without exponent notation and removes insignificant zeroes. */
export function decimalString(value: Decimal.Value) {
  const parsed = new ForecastDecimal(value);
  if (!parsed.isFinite()) throw new DecimalInputError(value);
  return parsed.isZero() ? "0" : parsed.toFixed();
}
