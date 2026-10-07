import "server-only";
import { cache } from "react";
import { database } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/session-store";
import { appearanceSchema, reportingCurrencySchema } from "@/lib/validation";
import { DEFAULT_REPORTING_CURRENCY, type ReportingCurrency } from "@/lib/currency";
import { DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";

export type Preferences = { reportingCurrency: ReportingCurrency; appearance: Appearance };

// Like the portfolio, preferences are reached only through an unexpired session, never a submitted user id.
// React's cache shares one query between the layout (appearance) and the page (currency) within a request.
export const getPreferences = cache(async (token: string | undefined): Promise<Preferences | null> => {
  if (!token || !validToken(token)) return null;
  const result = await database().query<{ reporting_currency: string; appearance: string }>(`SELECT u.reporting_currency, u.appearance FROM users u
    JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)]);
  if (result.rowCount !== 1) return null;
  // A stored value that is no longer offered falls back to the default instead of breaking every page.
  const currency = reportingCurrencySchema.safeParse(result.rows[0].reporting_currency);
  const appearance = appearanceSchema.safeParse(result.rows[0].appearance);
  return {
    reportingCurrency: currency.success ? currency.data : DEFAULT_REPORTING_CURRENCY,
    appearance: appearance.success ? appearance.data : DEFAULT_APPEARANCE,
  };
});
export async function getReportingCurrency(token: string | undefined) { return (await getPreferences(token))?.reportingCurrency ?? null; }
export async function getAppearance(token: string | undefined) { return (await getPreferences(token))?.appearance ?? null; }

export async function saveReportingCurrency(token: string | undefined, input: unknown) {
  const currency = reportingCurrencySchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const result = await database().query(`UPDATE users SET reporting_currency = $2
    FROM sessions s WHERE s.user_id = users.id AND s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token), currency]);
  if (result.rowCount !== 1) throw new Error("Authentication required.");
}

export async function saveAppearance(token: string | undefined, input: unknown) {
  const appearance = appearanceSchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const result = await database().query(`UPDATE users SET appearance = $2
    FROM sessions s WHERE s.user_id = users.id AND s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token), appearance]);
  if (result.rowCount !== 1) throw new Error("Authentication required.");
}
