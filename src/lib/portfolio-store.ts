import "server-only";
import { database } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/session-store";
import { portfolioNameSchema } from "@/lib/validation";
export type Portfolio = { id: string; name: string; created_at: Date };
export async function getPortfolio(token: string | undefined): Promise<Portfolio | null> {
  if (!token || !validToken(token)) return null;
  const result = await database().query<Portfolio>(`SELECT p.id, p.name, p.created_at FROM portfolios p
    JOIN sessions s ON s.user_id = p.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)]);
  return result.rows[0] ?? null;
}
export async function savePortfolio(token: string | undefined, input: unknown) {
  const name = portfolioNameSchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const result = await database().query(`INSERT INTO portfolios(user_id, name)
    SELECT user_id, $2 FROM sessions WHERE token_hash = $1 AND expires_at > now()
    ON CONFLICT(user_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id`, [tokenHash(token), name]);
  if (result.rowCount !== 1) throw new Error("Authentication required.");
}
