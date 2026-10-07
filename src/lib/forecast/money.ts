import { decimalString, parseDecimal } from "@/lib/forecast/decimal";

export const CURRENCIES = ["EUR", "USD", "SGD"] as const;
export type Currency = typeof CURRENCIES[number];

export type Money = Readonly<{
  amount: string;
  currency: Currency;
}>;

export class UnsupportedCurrencyError extends Error {
  constructor(readonly value: unknown) {
    super(`Expected one of EUR, USD or SGD, received ${JSON.stringify(value)}.`);
  }
}

export class CurrencyMismatchError extends Error {
  constructor(left: Currency, right: Currency) {
    super(`Cannot combine ${left} and ${right} amounts without an exchange rate.`);
  }
}

export function parseCurrency(value: unknown): Currency {
  if (typeof value !== "string" || !CURRENCIES.includes(value as Currency)) {
    throw new UnsupportedCurrencyError(value);
  }
  return value as Currency;
}

export function money(amount: string, currency: Currency): Money {
  return Object.freeze({ amount: decimalString(parseDecimal(amount)), currency: parseCurrency(currency) });
}

function sameCurrency(left: Money, right: Money) {
  const leftCurrency = parseCurrency(left.currency);
  const rightCurrency = parseCurrency(right.currency);
  if (leftCurrency !== rightCurrency) {
    throw new CurrencyMismatchError(leftCurrency, rightCurrency);
  }
  return leftCurrency;
}

export function addMoney(left: Money, right: Money): Money {
  const currency = sameCurrency(left, right);
  return money(decimalString(parseDecimal(left.amount).plus(parseDecimal(right.amount))), currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  const currency = sameCurrency(left, right);
  return money(decimalString(parseDecimal(left.amount).minus(parseDecimal(right.amount))), currency);
}

export function compareMoney(left: Money, right: Money) {
  sameCurrency(left, right);
  return parseDecimal(left.amount).comparedTo(parseDecimal(right.amount));
}

/** Explicit settlement/presentation rounding; calculations do not call this implicitly. */
export function roundMoney(value: Money, decimalPlaces = 2): Money {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
    throw new RangeError("decimalPlaces must be a non-negative integer.");
  }
  const rounded = parseDecimal(value.amount).toDecimalPlaces(decimalPlaces);
  return money(decimalString(rounded), value.currency);
}
