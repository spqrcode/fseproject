import { z } from "zod";
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address."),
  password: z.string().min(15, "Use at least 15 characters.").max(128, "Use at most 128 characters."),
});
export const portfolioNameSchema = z.string().trim().min(1, "Enter a portfolio name.").max(80, "Use at most 80 characters.");
export const uuidSchema = z.uuid();
export type FormState = { error?: string; success?: string };
