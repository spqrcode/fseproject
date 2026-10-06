import "server-only";
import { database } from "@/lib/db";
import { hasValidSession, tokenHash, validToken } from "@/lib/session-store";
import { dangerThresholdSchema, workspaceNameSchema } from "@/lib/validation";
export type Workspace = { id: string; name: string; created_at: Date };
export async function getWorkspace(token: string | undefined): Promise<Workspace | null> {
  if (!token || !validToken(token)) return null;
  const result = await database().query<Workspace>(`SELECT w.id, w.name, w.created_at FROM workspaces w
    JOIN sessions s ON s.user_id = w.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)]);
  return result.rows[0] ?? null;
}
export async function saveWorkspace(token: string | undefined, input: unknown) {
  const name = workspaceNameSchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const result = await database().query(`INSERT INTO workspaces(user_id, name)
    SELECT user_id, $2 FROM sessions WHERE token_hash = $1 AND expires_at > now()
    ON CONFLICT(user_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id`, [tokenHash(token), name]);
  if (result.rowCount !== 1) throw new Error("Authentication required.");
}

// The danger threshold is the balance below which the forecast warns. null means none is set.
// Returns null when there is no valid session or no workspace yet, so a stored null stays distinguishable.
export async function getDangerThreshold(token: string | undefined): Promise<{ dangerThreshold: string | null } | null> {
  if (!token || !validToken(token)) return null;
  const result = await database().query<{ danger_threshold: string | null }>(`SELECT w.danger_threshold::text AS danger_threshold FROM workspaces w
    JOIN sessions s ON s.user_id = w.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)]);
  return result.rows[0] ? { dangerThreshold: result.rows[0].danger_threshold } : null;
}
// Input is a plain decimal string with at most 2 decimals, or null to clear. Returns false when the caller
// has no workspace yet; throws without a valid session.
export async function saveDangerThreshold(token: string | undefined, input: unknown): Promise<boolean> {
  const threshold = dangerThresholdSchema.parse(input);
  const result = token && validToken(token) ? await database().query(`UPDATE workspaces SET danger_threshold = $2, updated_at = now()
    FROM sessions s WHERE s.user_id = workspaces.user_id AND s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token), threshold]) : null;
  if (result?.rowCount === 1) return true;
  if (!await hasValidSession(token)) throw new Error("Authentication required.");
  return false;
}
