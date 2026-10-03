import { decimalString, parseDecimal } from "@/lib/forecast/decimal";
import { money, parseCurrency, type Currency, type Money } from "@/lib/forecast/money";

/** `rate` is quote-currency units received for one base-currency unit. */
export type FxRate = Readonly<{
  base: Currency;
  quote: Currency;
  rate: string;
}>;

export class FxRateError extends Error {}

function validatedRatio(rate: FxRate) {
  const base = parseCurrency(rate.base);
  const quote = parseCurrency(rate.quote);
  if (base === quote) throw new FxRateError("An FX rate must contain two different currencies.");
  const ratio = parseDecimal(rate.rate);
  if (!ratio.greaterThan(0)) throw new FxRateError("An FX rate must be greater than zero.");
  return { base, quote, ratio };
}

export function fxRate(base: Currency, quote: Currency, rate: string): FxRate {
  const candidate = { base, quote, rate };
  const validated = validatedRatio(candidate);
  return Object.freeze({ base: validated.base, quote: validated.quote, rate: decimalString(validated.ratio) });
}

export function convertMoney(value: Money, target: Currency, rate?: FxRate): Money {
  const source = money(value.amount, value.currency);
  const targetCurrency = parseCurrency(target);
  if (source.currency === targetCurrency) return money(source.amount, targetCurrency);
  if (!rate) throw new FxRateError(`Missing FX rate for ${source.currency}/${targetCurrency}.`);

  const amount = parseDecimal(source.amount);
  const validated = validatedRatio(rate);

  if (validated.base === source.currency && validated.quote === targetCurrency) {
    return money(decimalString(amount.times(validated.ratio)), targetCurrency);
  }
  if (validated.quote === source.currency && validated.base === targetCurrency) {
    return money(decimalString(amount.dividedBy(validated.ratio)), targetCurrency);
  }
  throw new FxRateError(
    `FX rate ${validated.base}/${validated.quote} cannot convert ${source.currency} to ${targetCurrency}.`,
  );
}
