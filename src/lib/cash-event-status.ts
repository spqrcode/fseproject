// Lifecycle of a cash event. received applies to income and paid to expenses (the database checks
// the sign); cancelled events are left out of forecasts.
export const CASH_EVENT_STATUSES = ["expected", "received", "paid", "cancelled"] as const;
export type CashEventStatus = (typeof CASH_EVENT_STATUSES)[number];
