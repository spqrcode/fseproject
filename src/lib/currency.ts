// Currencies the interface can report in. The list follows the FX data the Scenarios & FX
// increment can supply; adding a code here is the only change needed to offer it.
export const REPORTING_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY"] as const;
export type ReportingCurrency = (typeof REPORTING_CURRENCIES)[number];
export const DEFAULT_REPORTING_CURRENCY: ReportingCurrency = "EUR";
export const CURRENCY_NAMES: Record<ReportingCurrency, string> = {
  EUR: "Euro",
  USD: "US dollar",
  GBP: "Pound sterling",
  CHF: "Swiss franc",
  JPY: "Japanese yen",
};
export function currencyLabel(code: ReportingCurrency) { return `${CURRENCY_NAMES[code]} (${code})`; }
