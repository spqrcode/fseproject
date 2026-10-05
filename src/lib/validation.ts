import { z } from "zod";
import { REPORTING_CURRENCIES } from "@/lib/currency";
import { APPEARANCES } from "@/lib/appearance";
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address."),
  password: z.string().min(15, "Use at least 15 characters.").max(128, "Use at most 128 characters."),
});
export const portfolioNameSchema = z.string().trim().min(1, "Enter a workspace name.").max(80, "Use at most 80 characters.");
export const reportingCurrencySchema = z.enum(REPORTING_CURRENCIES, { error: "Choose one of the listed currencies." });
export const appearanceSchema = z.enum(APPEARANCES, { error: "Choose light, dark or match this device." });
export type FormState = { error?: string; success?: string };
