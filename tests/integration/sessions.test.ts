import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession, findSession, tokenHash } from "@/lib/session-store";
import { listActiveSessions, revokeOtherSessions } from "@/lib/account-sessions";
import { signOutOtherSessions } from "@/app/actions/account";
import { SESSION_COOKIE } from "@/lib/auth";

// Same request adapters as ownership.test.ts: only Next.js cookies, headers, redirect and cache are mocked.
const request = vi.hoisted(() => ({ origin: "http://localhost:3100" as string | null, cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.origin ? { origin: request.origin } : {}),
  cookies: async () => ({
    get: (name: string) => request.cookies.has(name) ? { value: request.cookies.get(name) } : undefined,
    set: (name: string, value: string) => request.cookies.set(name, value),
    delete: (name: string) => request.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test") || process.env.DATABASE_URL !== url) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}
const emails: string[] = [];
const ids: string[] = [];
let alice: string, aliceLaptop: string, bob: string;
async function expire(token: string) {
  await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [tokenHash(token)]);
}
beforeEach(async () => {
  request.origin = "http://localhost:3100";
  request.cookies.clear();
  for (let index = 0; index < 2; index++) {
    const email = `sessions-${randomUUID()}@example.com`;
    emails.push(email);
    const result = await database().query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email]);
    ids.push(result.rows[0].id);
  }
  aliceLaptop = (await createSession(ids[0])).token;
  alice = (await createSession(ids[0])).token;
  bob = (await createSession(ids[1])).token;
});
afterEach(async () => {
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
  ids.length = 0;
});
afterAll(async () => { await database().end(); });

describe("active sessions with a real database", () => {
  it("lists only the user's own unexpired sessions, current first, without token digests", async () => {
    const stale = (await createSession(ids[0])).token;
    await expire(stale);
    const sessions = await listActiveSessions(alice);
    expect(sessions.map(session => session.current)).toEqual([true, false]);
    for (const session of sessions) expect(Object.keys(session).sort()).toEqual(["createdAt", "current", "expiresAt"]);
    expect(await listActiveSessions(bob)).toHaveLength(1);
  });
  it("signs out the user's other sessions and keeps the current one and other users' sessions", async () => {
    request.cookies.set(SESSION_COOKIE, alice);
    expect(await signOutOtherSessions()).toEqual({ success: "Signed out of 1 other session." });
    expect(await findSession(aliceLaptop)).toBeNull();
    expect(await findSession(alice)).toEqual({ id: ids[0], email: emails[0] });
    expect(await findSession(bob)).toEqual({ id: ids[1], email: emails[1] });
  });
  it("reports how many sessions were removed", async () => {
    await createSession(ids[0]);
    request.cookies.set(SESSION_COOKIE, alice);
    expect(await signOutOtherSessions()).toEqual({ success: "Signed out of 2 other sessions." });
    expect(await signOutOtherSessions()).toEqual({ success: "No other sessions were active." });
  });
  it.each([null, "https://untrusted.example"])("rejects missing or foreign origin without signing anything out: %s", async origin => {
    request.cookies.set(SESSION_COOKIE, alice);
    request.origin = origin;
    expect((await signOutOtherSessions()).error).toBe("Unable to sign out your other sessions. Please try again.");
    expect(await findSession(aliceLaptop)).not.toBeNull();
  });
  it("sends anonymous, unknown and expired sessions to sign in without deleting anything", async () => {
    await expect(signOutOtherSessions()).rejects.toThrow("redirect:/login");
    request.cookies.set(SESSION_COOKIE, "c".repeat(64));
    await expect(signOutOtherSessions()).rejects.toThrow("redirect:/login");
    await expire(alice);
    request.cookies.set(SESSION_COOKIE, alice);
    await expect(signOutOtherSessions()).rejects.toThrow("redirect:/login");
    expect(await findSession(aliceLaptop)).not.toBeNull();
  });
  it("store functions refuse malformed tokens and an expired token deletes nothing", async () => {
    for (const token of [undefined, "not-a-token"]) {
      expect(await listActiveSessions(token)).toEqual([]);
      await expect(revokeOtherSessions(token)).rejects.toThrow("Authentication required.");
    }
    expect(await listActiveSessions("d".repeat(64))).toEqual([]);
    expect(await revokeOtherSessions("d".repeat(64))).toBe(0);
    await expire(alice);
    expect(await listActiveSessions(alice)).toEqual([]);
    expect(await revokeOtherSessions(alice)).toBe(0);
    expect(await findSession(aliceLaptop)).not.toBeNull();
  });
});
