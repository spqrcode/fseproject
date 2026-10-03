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

// Member C — cash events, forecast engine, and scenario isolation
export {
  CashEventValidationError,
  parseCashEvent,
  type CashEvent,
  type RawCashEvent,
} from "@/lib/forecast/cash-event";
export {
  runForecast,
  scenarioContribution,
  type ForecastInput,
  type ForecastPoint,
  type ForecastResult,
} from "@/lib/forecast/forecast-engine";
export {
  applyDelayAdjustment,
  runScenarioForecast,
  InvalidAdjustmentError,
  MissingEventError,
  type DelayAdjustment,
  type ScenarioProjection,
} from "@/lib/forecast/scenario";
