import { z } from "zod";
import { REPORTING_CURRENCIES } from "@/lib/currency";
import { APPEARANCES } from "@/lib/appearance";
import { CASH_EVENT_STATUSES } from "@/lib/cash-event-status";
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address."),
  password: z.string().min(15, "Use at least 15 characters.").max(128, "Use at most 128 characters."),
});
export const workspaceNameSchema = z.string().trim().min(1, "Enter a workspace name.").max(80, "Use at most 80 characters.");
export const reportingCurrencySchema = z.enum(REPORTING_CURRENCIES, { error: "Choose one of the listed currencies." });
export const appearanceSchema = z.enum(APPEARANCES, { error: "Choose light, dark or match this device." });

// Amounts are plain decimal strings: an optional leading minus, no leading zeros, at most 18 integer
// digits and 2 decimals (numeric(20,2)). No exponent, NaN, plus sign or separators. This is a subset
// of what the forecast engine's parseDecimal accepts.
const AMOUNT = /^-?(0|[1-9]\d{0,17})(\.\d{1,2})?$/;
const AMOUNT_MESSAGE = "Enter a plain amount with at most 2 decimals, for example 1250.50 or -80.";
// Opening balances and the danger threshold may be zero.
export const balanceSchema = z.string().regex(AMOUNT, AMOUNT_MESSAGE);
// Events may not be zero: income is positive, expenses negative.
export const eventAmountSchema = balanceSchema.refine(value => !/^-?0(\.0+)?$/.test(value), "The amount cannot be zero.");
export const dangerThresholdSchema = balanceSchema.nullable();
export const accountNameSchema = z.string().trim().min(1, "Enter an account name.").max(80, "Use at most 80 characters.");
export const eventDescriptionSchema = z.string().trim().min(1, "Enter a description.").max(200, "Use at most 200 characters.");
export const eventStatusSchema = z.enum(CASH_EVENT_STATUSES, { error: "Choose a valid status." });
export const uuidSchema = z.uuid();
// Date only, a real calendar day, 2000 to 2100. The range keeps out dates PostgreSQL would reject.
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD.").refine(value => {
  const year = Number(value.slice(0, 4));
  const date = new Date(`${value}T00:00:00Z`);
  return year >= 2000 && year <= 2100 && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a real date between 2000 and 2100.");
// A forecast range: both ends valid dates, start not after end, at most 366 dates counting both ends (the
// engine loops per day and accepts at most 366 dates).
export const forecastRangeSchema = z.object({ startDate: isoDateSchema, endDate: isoDateSchema }).superRefine((range, ctx) => {
  const days = (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000;
  if (days < 0) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date must not be before the start date." });
  else if (days + 1 > 366) ctx.addIssue({ code: "custom", path: ["endDate"], message: "A forecast covers at most 366 days, counting both the first and the last day." });
});
export const cashAccountSchema = z.object({ name: accountNameSchema, currency: reportingCurrencySchema, openingBalance: balanceSchema });
export const cashEventSchema = z.object({ description: eventDescriptionSchema, amount: eventAmountSchema, expectedDate: isoDateSchema });
export type FormState = { error?: string; success?: string };
