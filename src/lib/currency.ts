// Currencies the interface can report in, as agreed by the team on 2 October 2026: the euro, the
// US dollar and the Singapore dollar for the APAC use case. All three are ECB reference rates, and the
// forecast engine accepts the same three. To offer another code, add it here, to the list in
// docs/requirements.md and to the forecast engine; the database only checks the three-letter shape.
export const REPORTING_CURRENCIES = ["EUR", "USD", "SGD"] as const;
export type ReportingCurrency = (typeof REPORTING_CURRENCIES)[number];
export const DEFAULT_REPORTING_CURRENCY: ReportingCurrency = "EUR";
export const CURRENCY_NAMES: Record<ReportingCurrency, string> = {
  EUR: "Euro",
  USD: "US dollar",
  SGD: "Singapore dollar",
};
export function currencyLabel(code: ReportingCurrency) { return `${CURRENCY_NAMES[code]} (${code})`; }
