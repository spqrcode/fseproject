import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { database } from "@/lib/db";
export const SESSION_SECONDS = 60 * 60 * 24;
export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function validToken(token: string) { return /^[a-f0-9]{64}$/.test(token); }
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
  await database().query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash(token), userId, expires]);
  return { token, expires };
}
export async function findSession(token: string | undefined): Promise<{ id: string; email: string } | null> {
  if (!token || !validToken(token)) return null;
  const result = await database().query<{ id: string; email: string }>("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()", [tokenHash(token)]);
  return result.rows[0] ?? null;
}
export async function revokeSession(token: string | undefined) {
  if (token && validToken(token)) await database().query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}
