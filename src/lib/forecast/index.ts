// Keep Decimal construction internal so callers cannot bypass Money and FX
// validation. The input error remains public for boundary error handling.
export { DecimalInputError } from "@/lib/forecast/decimal";
export { convertMoney, fxRate, FxRateError, type FxRate } from "@/lib/forecast/fx";
export {
  addMoney,
  compareMoney,
  CURRENCIES,
  CurrencyMismatchError,
  money,
  parseCurrency,
  roundMoney,
  subtractMoney,
  UnsupportedCurrencyError,
  type Currency,
  type Money,
} from "@/lib/forecast/money";
