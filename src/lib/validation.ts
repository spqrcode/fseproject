import { z } from "zod";
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address."),
  password: z.string().min(15, "Use at least 15 characters.").max(128, "Use at most 128 characters."),
});
export const portfolioNameSchema = z.string().trim().min(1, "Enter a portfolio name.").max(80, "Use at most 80 characters.");

// Ticker shape covers plain US symbols and the "BRK.B" / "VWCE.DE" suffix form.
const SYMBOL = /^[A-Z][A-Z0-9]{0,9}(\.[A-Z]{1,4})?$/;
// Plain decimal digits only. Written as a string test so "NaN", "Infinity",
// "1e5", "-1" and "+1" are rejected before any numeric conversion happens.
// Up to 12 digits before the point and 8 after, matching numeric(20, 8) exactly
// so a value the form accepts can never overflow the column.
const DECIMAL = /^\d{1,12}(\.\d{1,8})?$/;
export const PRICE_MAX = 1_000_000_000;

export const symbolSchema = z.string().trim().toUpperCase()
  .refine(value => SYMBOL.test(value), "Use a ticker such as AAPL or BRK.B.");

function amount(label: string, max?: number) {
  const schema = z.string().trim()
    .refine(value => DECIMAL.test(value), `Enter the ${label} as a plain number with up to 12 digits and 8 decimals.`)
    .refine(value => Number(value) > 0, `Enter a ${label} greater than zero.`);
  return max === undefined ? schema
    : schema.refine(value => Number(value) <= max, `Enter a ${label} of at most ${max.toLocaleString("en-US")}.`);
}

export const holdingSchema = z.object({
  symbol: symbolSchema,
  quantity: amount("quantity"),
  averageBuyPrice: amount("purchase price", PRICE_MAX),
});
export type HoldingInput = z.infer<typeof holdingSchema>;

export const holdingIdSchema = z.uuid("Unknown holding.");
export type FormState = { error?: string; success?: string };
