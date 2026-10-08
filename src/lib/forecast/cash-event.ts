/**
 * CashEvent domain type.
 *
 * Financial rules:
 *  - Income is positive, expense is negative.
 *  - Zero-value events are invalid.
 *  - expected_date is date-only (YYYY-MM-DD); no time component.
 *  - amount and currency are validated on construction; callers may not
 *    construct a CashEvent with a zero amount or unsupported currency.
 *
 * This is a pure domain type with no database or network dependency.
 * Canonical persistence lives in src/lib/cash-events-store.ts. This domain
 * contract remains provisional until the Forecast Engine PR is finalized.
 */

import { parseDecimal, DecimalInputError } from "@/lib/forecast/decimal";
import { parseCurrency, type Currency } from "@/lib/forecast/money";

export type CashEvent = Readonly<{
  /** Stable row identifier (UUID). */
  id: string;
  /** Owning user's identifier (UUID). */
  userId: string;
  /** Human-readable label, 1–200 trimmed characters. */
  description: string;
  /**
   * Signed decimal string: positive for income, negative for expense.
   * Stored at full precision; never rounded internally.
   */
  amount: string;
  /** ISO 4217 code, restricted to EUR | USD | SGD. */
  currency: Currency;
  /**
   * Date-only string (YYYY-MM-DD).  No time component.  Events on the
   * forecast start date are included in the forecast.
   */
  expectedDate: string;
}>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export class CashEventValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`CashEvent.${field}: ${message}`);
  }
}

function validateDate(value: unknown): string {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new CashEventValidationError(
      "expectedDate",
      `Expected a YYYY-MM-DD date string, received ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function validateDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new CashEventValidationError("description", "Must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 200 || trimmed !== value) {
    throw new CashEventValidationError(
      "description",
      "Must be 1–200 characters and already trimmed.",
    );
  }
  return trimmed;
}

function validateAmount(value: unknown): string {
  if (typeof value !== "string") {
    throw new CashEventValidationError("amount", "Must be a decimal string.");
  }
  let parsed;
  try {
    parsed = parseDecimal(value);
  } catch (error) {
    if (error instanceof DecimalInputError) {
      throw new CashEventValidationError("amount", error.message);
    }
    throw error;
  }
  if (parsed.isZero()) {
    throw new CashEventValidationError("amount", "Zero-value cash events are invalid.");
  }
  return parsed.toFixed();
}

export interface RawCashEvent {
  id: string;
  userId: string;
  description: string;
  amount: string;
  currency: unknown;
  expectedDate: unknown;
}

/** Parse and validate a raw record (e.g. from the database or API input). */
export function parseCashEvent(raw: RawCashEvent): CashEvent {
  return Object.freeze({
    id: raw.id,
    userId: raw.userId,
    description: validateDescription(raw.description),
    amount: validateAmount(raw.amount),
    currency: parseCurrency(raw.currency),
    expectedDate: validateDate(raw.expectedDate),
  });
}
