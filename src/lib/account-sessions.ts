import "server-only";
import { database } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/session-store";

export type ActiveSession = { createdAt: Date; expiresAt: Date; current: boolean };

// The signed-in user's unexpired sessions, newest first after the current one. Token digests never leave the server.
export async function listActiveSessions(token: string | undefined): Promise<ActiveSession[]> {
  if (!token || !validToken(token)) return [];
  const result = await database().query<{ created_at: Date; expires_at: Date; current: boolean }>(`
    SELECT other.created_at, other.expires_at, other.token_hash = mine.token_hash AS current
    FROM sessions mine JOIN sessions other ON other.user_id = mine.user_id
    WHERE mine.token_hash = $1 AND mine.expires_at > now() AND other.expires_at > now()
    ORDER BY current DESC, other.created_at DESC
    LIMIT 50`, [tokenHash(token)]);
  return result.rows.map(row => ({ createdAt: row.created_at, expiresAt: row.expires_at, current: row.current }));
}

// Deletes the user's other active sessions and keeps the current one. An unknown or expired
// caller token matches no row in `mine`, so it cannot delete anything. Returns how many were removed.
export async function revokeOtherSessions(token: string | undefined): Promise<number> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const result = await database().query(`
    DELETE FROM sessions other USING sessions mine
    WHERE mine.token_hash = $1 AND mine.expires_at > now()
      AND other.user_id = mine.user_id AND other.token_hash <> mine.token_hash AND other.expires_at > now()`, [tokenHash(token)]);
  return result.rowCount ?? 0;
}
