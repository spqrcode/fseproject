import "server-only";
import { database } from "@/lib/db";
import { tokenHash } from "@/lib/session-store";

export const AUTH_ATTEMPTS = 10;
export function authLimitKey(email: string) {
  return `account:${tokenHash(email.trim().toLowerCase())}`;
}

export async function allowAuthAttempt(email: string): Promise<boolean> {
  // PostgreSQL serializes concurrent updates to the same account's counter.
  const result = await database().query<{ attempts: number }>(`
    INSERT INTO auth_limits(key, attempts, reset_at) VALUES ($1, 1, now() + interval '15 minutes')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_limits.reset_at <= now() THEN 1 ELSE LEAST(auth_limits.attempts + 1, 11) END,
      reset_at = CASE WHEN auth_limits.reset_at <= now() THEN now() + interval '15 minutes' ELSE auth_limits.reset_at END
    RETURNING attempts`, [authLimitKey(email)]);
  return result.rows[0].attempts <= AUTH_ATTEMPTS;
}
