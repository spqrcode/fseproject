// Keep Decimal construction internal so callers cannot bypass Money and FX
// validation. The input error remains public for boundary error handling.
export {
  CASH_EVENT_STATUSES,
  CashEventValidationError,
  parseCashEvent,
  type CashEvent,
  type CashEventStatus,
  type RawCashEvent,
} from "@/lib/forecast/cash-event";
export { DecimalInputError } from "@/lib/forecast/decimal";
export {
  toForecastInput,
  type StoredForecastEvent,
  type StoredForecastInput,
} from "@/lib/forecast/input-adapter";
export {
  DANGER_THRESHOLD_PERCENT,
  ForecastInputError,
  MAX_FORECAST_DAYS,
  runForecast,
  type ForecastInput,
  type ForecastPoint,
  type ForecastResult,
} from "@/lib/forecast/forecast-engine";
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

export {
  applyDelayAdjustment,
  partitionAdjustments,
  runScenarioForecast,
  type SkippedAdjustment,
  scenarioContribution,
  InvalidAdjustmentError,
  MissingEventError,
  type DelayAdjustment,
  type ScenarioProjection,
} from "@/lib/forecast/scenario";
