import "server-only";
import { database } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/session-store";
import { reportingCurrencySchema } from "@/lib/validation";
import { DEFAULT_REPORTING_CURRENCY, type ReportingCurrency } from "@/lib/currency";

// Like the portfolio, the preference is reached only through an unexpired session, never a submitted user id.
export async function getReportingCurrency(token: string | undefined): Promise<ReportingCurrency | null> {
  if (!token || !validToken(token)) return null;
  const result = await database().query<{ reporting_currency: string }>(`SELECT u.reporting_currency FROM users u
    JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)]);
  if (result.rowCount !== 1) return null;
  // A stored code that is no longer offered falls back to the default instead of breaking every page.
  const stored = reportingCurrencySchema.safeParse(result.rows[0].reporting_currency);
  return stored.success ? stored.data : DEFAULT_REPORTING_CURRENCY;
}

export async function saveReportingCurrency(token: string | undefined, input: unknown) {
  const currency = reportingCurrencySchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const result = await database().query(`UPDATE users SET reporting_currency = $2
    FROM sessions s WHERE s.user_id = users.id AND s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token), currency]);
  if (result.rowCount !== 1) throw new Error("Authentication required.");
}
