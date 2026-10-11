import { DecimalInputError, parseDecimal } from "@/lib/forecast/decimal";
import {
  parseCurrency,
  UnsupportedCurrencyError,
  type Currency,
} from "@/lib/forecast/money";

export const CASH_EVENT_STATUSES = ["expected", "received", "paid", "cancelled"] as const;
export type CashEventStatus = (typeof CASH_EVENT_STATUSES)[number];

export type CashEvent = Readonly<{
  id: string;
  amount: string;
  currency: Currency;
  expectedDate: string;
  createdAt: string;
  status: CashEventStatus;
}>;

export type RawCashEvent = Readonly<{
  id: unknown;
  amount: unknown;
  currency: unknown;
  expectedDate: unknown;
  createdAt: unknown;
  status: unknown;
}>;

export class CashEventValidationError extends Error {
  constructor(
    readonly field: keyof RawCashEvent,
    message: string,
  ) {
    super(`CashEvent.${field}: ${message}`);
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?Z$/;

function validateIdentifier(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new CashEventValidationError("id", "Must be a non-empty, already-trimmed string.");
  }
  return value;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseForecastDate(field: "expectedDate", value: unknown) {
  if (typeof value !== "string") {
    throw new CashEventValidationError(field, "Expected a YYYY-MM-DD date string.");
  }

  const match = DATE_ONLY.exec(value);
  if (!match) {
    throw new CashEventValidationError(field, "Expected a YYYY-MM-DD date string.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new CashEventValidationError(field, `Invalid calendar date ${JSON.stringify(value)}.`);
  }
  return value;
}

function validateCreatedAt(value: unknown) {
  if (typeof value !== "string") {
    throw new CashEventValidationError("createdAt", "Expected a UTC timestamp ending in Z.");
  }

  const match = UTC_TIMESTAMP.exec(value);
  if (!match) {
    throw new CashEventValidationError("createdAt", "Expected a UTC timestamp ending in Z.");
  }

  try {
    parseForecastDate("expectedDate", match[1]);
  } catch {
    throw new CashEventValidationError("createdAt", `Invalid UTC timestamp ${JSON.stringify(value)}.`);
  }

  const milliseconds = (match[5] ?? "").padEnd(3, "0");
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${milliseconds}Z`;
}

function validateAmount(value: unknown) {
  if (typeof value !== "string") {
    throw new CashEventValidationError("amount", "Must be a plain decimal string.");
  }

  try {
    const parsed = parseDecimal(value);
    if (parsed.isZero()) {
      throw new CashEventValidationError("amount", "Zero-value cash events are invalid.");
    }
    return parsed.toFixed();
  } catch (error) {
    if (error instanceof CashEventValidationError) throw error;
    if (error instanceof DecimalInputError) {
      throw new CashEventValidationError("amount", error.message);
    }
    throw error;
  }
}

function validateCurrency(value: unknown) {
  try {
    return parseCurrency(value);
  } catch (error) {
    if (error instanceof UnsupportedCurrencyError) {
      throw new CashEventValidationError("currency", error.message);
    }
    throw error;
  }
}

function validateStatus(value: unknown): CashEventStatus {
  if (typeof value !== "string" || !CASH_EVENT_STATUSES.includes(value as CashEventStatus)) {
    throw new CashEventValidationError(
      "status",
      "Expected one of expected, received, paid or cancelled.",
    );
  }
  return value as CashEventStatus;
}

export function parseCashEvent(raw: RawCashEvent): CashEvent {
  return Object.freeze({
    id: validateIdentifier(raw.id),
    amount: validateAmount(raw.amount),
    currency: validateCurrency(raw.currency),
    expectedDate: parseForecastDate("expectedDate", raw.expectedDate),
    createdAt: validateCreatedAt(raw.createdAt),
    status: validateStatus(raw.status),
  });
}
