import "server-only";
import { database } from "@/lib/db";
import { tokenHash } from "@/lib/session-store";

export const AUTH_ATTEMPTS = 10;
// Separate scopes give login and registration separate counters, so registering cannot lock a login.
type AuthScope = "login" | "register";
export function authLimitKey(email: string, scope: AuthScope = "login") {
  return `${scope}:${tokenHash(email.trim().toLowerCase())}`;
}

async function incrementAttempts(key: string): Promise<number> {
  // PostgreSQL serializes concurrent updates to the same account's counter.
  const result = await database().query<{ attempts: number }>(`
    INSERT INTO auth_limits(key, attempts, reset_at) VALUES ($1, 1, now() + interval '15 minutes')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_limits.reset_at <= now() THEN 1 ELSE LEAST(auth_limits.attempts + 1, 11) END,
      reset_at = CASE WHEN auth_limits.reset_at <= now() THEN now() + interval '15 minutes' ELSE auth_limits.reset_at END
    RETURNING attempts`, [key]);
  return result.rows[0].attempts;
}

// Counts the attempt first, then compares: used where every attempt counts (registration).
export async function allowAuthAttempt(email: string, scope: AuthScope): Promise<boolean> {
  return await incrementAttempts(authLimitKey(email, scope)) <= AUTH_ATTEMPTS;
}

// Read-only: false only while an unexpired window has already reached the limit.
export async function authAttemptsAllowed(email: string): Promise<boolean> {
  const result = await database().query(
    "SELECT 1 FROM auth_limits WHERE key = $1 AND reset_at > now() AND attempts >= $2",
    [authLimitKey(email), AUTH_ATTEMPTS]);
  return result.rowCount === 0;
}

export async function recordFailedAuth(email: string): Promise<void> {
  await incrementAttempts(authLimitKey(email));
}

// Closes the window instead of deleting: the runtime role has no DELETE on auth_limits.
export async function clearAuthAttempts(email: string): Promise<void> {
  await database().query("UPDATE auth_limits SET reset_at = now() WHERE key = $1 AND reset_at > now()", [authLimitKey(email)]);
}
