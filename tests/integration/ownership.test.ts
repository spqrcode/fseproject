import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession, findSession, revokeSession, tokenHash } from "@/lib/session-store";
import { getDangerThreshold, saveDangerThreshold, saveWorkspace, getWorkspace } from "@/lib/workspace-store";
import { allowAuthAttempt, authLimitKey, recordFailedAuth } from "@/lib/rate-limit";
import { register, login, logout } from "@/app/actions/auth";
import { updateDangerThreshold, updateWorkspace } from "@/app/actions/workspace";
import { requireUser, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

const request = vi.hoisted(() => ({
  origin: "http://localhost:3100" as string | null,
  cookies: new Map<string, string>(),
  setCookie: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.origin ? { origin: request.origin } : {}),
  cookies: async () => ({
    get: (name: string) => request.cookies.has(name) ? { value: request.cookies.get(name) } : undefined,
    set: (name: string, value: string, options: unknown) => {
      request.cookies.set(name, value);
      request.setCookie(name, value, options);
    },
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
let alice: string, bob: string;
const password = "a test-only long passphrase";
let passwordHash: string;
function uniqueEmail() {
  const email = `integration-${randomUUID()}@example.com`;
  emails.push(email);
  return email;
}
function credentials(email: string, value = password) {
  const form = new FormData();
  form.set("email", email);
  form.set("password", value);
  return form;
}
beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(async () => {
  request.origin = "http://localhost:3100";
  request.cookies.clear();
  request.setCookie.mockClear();
  for (let index = 0; index < 2; index++) {
    const result = await database().query("INSERT INTO users(email,password_hash) VALUES ($1,$2) RETURNING id", [uniqueEmail(), passwordHash]);
    ids.push(result.rows[0].id);
  }
  alice = (await createSession(ids[0])).token;
  bob = (await createSession(ids[1])).token;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  await database().query("DELETE FROM auth_limits WHERE key = ANY($1::text[])", [emails.flatMap(email => [authLimitKey(email), authLimitKey(email, "register")])]);
  emails.length = 0;
  ids.length = 0;
});
afterAll(async () => { await database().end(); });

describe("database-backed authentication and ownership", () => {
  it("stores only the token hash and returns minimal identity", async () => {
    const session = await database().query("SELECT token_hash FROM sessions WHERE user_id = $1", [ids[0]]);
    expect(session.rows[0].token_hash).toBe(tokenHash(alice));
    expect(session.rows[0].token_hash).not.toBe(alice);
    expect(await findSession(alice)).toEqual({ id: ids[0], email: emails[0] });
    expect(await findSession("bad")).toBeNull();
  });
  it("isolates the existing workspace operations across two users", async () => {
    await saveWorkspace(alice, "Alice portfolio");
    expect(await getWorkspace(bob)).toBeNull();
    await saveWorkspace(bob, "Bob portfolio");
    await saveWorkspace(bob, "Bob renamed");
    expect((await getWorkspace(alice))?.name).toBe("Alice portfolio");
    expect((await getWorkspace(bob))?.name).toBe("Bob renamed");
    const count = await database().query("SELECT count(*)::int AS count FROM workspaces WHERE user_id = $1", [ids[1]]);
    expect(count.rows[0].count).toBe(1);
  });
  it("rejects anonymous, unknown-token and invalid writes", async () => {
    expect(await getWorkspace(undefined)).toBeNull();
    expect(await getWorkspace("0".repeat(64))).toBeNull();
    await expect(saveWorkspace(undefined, "forged")).rejects.toThrow();
    await expect(saveWorkspace("0".repeat(64), "forged")).rejects.toThrow();
    await expect(saveWorkspace(alice, " ")).rejects.toThrow();
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
  it("enforces email uniqueness and workspace constraints in SQL", async () => {
    await expect(database().query("INSERT INTO users(email,password_hash) VALUES($1,$2)", [emails[0], passwordHash])).rejects.toMatchObject({ code: "23505" });
    await saveWorkspace(alice, "Valid");
    await expect(database().query("INSERT INTO workspaces(user_id,name) VALUES($1,'duplicate')", [ids[0]])).rejects.toMatchObject({ code: "23505" });
    await expect(database().query("UPDATE workspaces SET name = ' ' WHERE user_id = $1", [ids[0]])).rejects.toMatchObject({ code: "23514" });
  });
  it("treats SQL-looking input as data", async () => {
    const name = "Robert'); DROP TABLE users; --";
    await saveWorkspace(alice, name);
    expect((await getWorkspace(alice))?.name).toBe(name);
    expect(await findSession(bob)).not.toBeNull();
  });
  it("expiry blocks identity, reads, and writes despite an existing cookie", async () => {
    await saveWorkspace(alice, "Private");
    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [tokenHash(alice)]);
    request.cookies.set(SESSION_COOKIE, alice);
    expect(await findSession(alice)).toBeNull();
    expect(await getWorkspace(alice)).toBeNull();
    await expect(saveWorkspace(alice, "forged")).rejects.toThrow();
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
  it("revocation prevents replay without revoking another user's session", async () => {
    await revokeSession(alice);
    expect(await findSession(alice)).toBeNull();
    await expect(saveWorkspace(alice, "replay")).rejects.toThrow();
    expect(await findSession(bob)).not.toBeNull();
  });
});

describe("authentication throttle", () => {
  it("allows exactly ten simultaneous attempts per normalized address", async () => {
    const email = uniqueEmail();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => allowAuthAttempt(i % 2 ? ` ${email.toUpperCase()} ` : email, "register")));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await allowAuthAttempt(uniqueEmail(), "register")).toBe(true);
  });
  it("does not have an application-wide lockout after 100 requests", async () => {
    for (let i = 0; i < 105; i++) expect(await allowAuthAttempt(uniqueEmail(), "register")).toBe(true);
    expect(await allowAuthAttempt(uniqueEmail(), "register")).toBe(true);
  });
  it("resets an expired window and does not extend it for blocked attempts", async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 10; i++) await allowAuthAttempt(email, "register");
    const before = await database().query("SELECT reset_at FROM auth_limits WHERE key=$1", [authLimitKey(email, "register")]);
    expect(await allowAuthAttempt(email, "register")).toBe(false);
    const after = await database().query("SELECT reset_at FROM auth_limits WHERE key=$1", [authLimitKey(email, "register")]);
    expect(after.rows[0].reset_at).toEqual(before.rows[0].reset_at);
    await database().query("UPDATE auth_limits SET reset_at=now()-interval '1 second' WHERE key=$1", [authLimitKey(email, "register")]);
    expect(await allowAuthAttempt(email, "register")).toBe(true);
  });
});

describe("server actions with a real database", () => {
  it("registers without disclosing duplicates or replacing an existing password", async () => {
    const email = uniqueEmail();
    const first = await register({}, credentials(email));
    const stored = await database().query("SELECT password_hash FROM users WHERE email=$1", [email]);
    expect(first.success).toBeTruthy();
    expect(stored.rows[0].password_hash).not.toBe(password);
    expect(await register({}, credentials(email, "a different test password"))).toEqual(first);
    const unchanged = await database().query("SELECT password_hash FROM users WHERE email=$1", [email]);
    expect(unchanged.rows[0].password_hash).toBe(stored.rows[0].password_hash);
  });
  it("rejects invalid input before touching the database", async () => {
    const query = vi.spyOn(database(), "query");
    expect((await register({}, credentials("invalid", "short"))).error).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
  });
  it.each([null, "https://untrusted.example"])("rejects missing or foreign origin: %s", async origin => {
    request.origin = origin;
    const query = vi.spyOn(database(), "query");
    expect((await register({}, credentials(uniqueEmail()))).error).toBeTruthy();
    expect((await login({}, credentials(emails[0]))).error).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
  });
  it.each([null, "https://untrusted.example"])("rejects missing or foreign origin for logout and workspace updates without changing data: %s", async origin => {
    await saveWorkspace(alice, "Original name");
    await saveDangerThreshold(alice, "100");
    request.cookies.set(SESSION_COOKIE, alice);
    request.origin = origin;
    const form = new FormData();
    form.set("name", "Changed by forged request");
    const threshold = new FormData();
    threshold.set("dangerThreshold", "999");
    expect((await logout()).error).toBeTruthy();
    expect((await updateWorkspace({}, form)).error).toBeTruthy();
    expect((await updateDangerThreshold({}, threshold)).error).toBeTruthy();
    expect((await getWorkspace(alice))?.name).toBe("Original name");
    expect(await getDangerThreshold(alice)).toEqual({ dangerThreshold: "100.00" });
    expect(await findSession(alice)).toEqual({ id: ids[0], email: emails[0] });
    expect(request.cookies.get(SESSION_COOKIE)).toBe(alice);
  });
  it("sets and clears the signed-in workspace danger threshold through the server action", async () => {
    await saveWorkspace(alice, "Threshold workspace");
    request.cookies.set(SESSION_COOKIE, alice);
    const form = new FormData();
    form.set("dangerThreshold", "750.5");
    expect(await updateDangerThreshold({}, form)).toEqual({ success: "Danger threshold saved." });
    expect(await getDangerThreshold(alice)).toEqual({ dangerThreshold: "750.50" });
    expect(await getDangerThreshold(bob)).toBeNull();

    form.set("dangerThreshold", "1.234");
    expect((await updateDangerThreshold({}, form)).error).toContain("at most 2 decimals");
    expect(await getDangerThreshold(alice)).toEqual({ dangerThreshold: "750.50" });

    form.set("dangerThreshold", "");
    expect(await updateDangerThreshold({}, form)).toEqual({ success: "Default danger threshold restored." });
    expect(await getDangerThreshold(alice)).toEqual({ dangerThreshold: null });
  });
  it("does not create a workspace implicitly when saving a danger threshold", async () => {
    request.cookies.set(SESSION_COOKIE, alice);
    const form = new FormData();
    form.set("dangerThreshold", "100");
    expect(await updateDangerThreshold({}, form)).toEqual({ error: "Create your workspace before setting a danger threshold." });
    expect(await getWorkspace(alice)).toBeNull();
  });
  it("returns the same response for wrong passwords and unknown accounts", async () => {
    expect(await login({}, credentials(emails[0], "a wrong long password"))).toEqual(await login({}, credentials(uniqueEmail(), "a wrong long password")));
  });
  it("rotates the current session on login and sets a bounded host-only cookie", async () => {
    request.cookies.set(SESSION_COOKIE, alice);
    await expect(login({}, credentials(emails[0]))).rejects.toThrow("redirect:/dashboard");
    expect(await findSession(alice)).toBeNull();
    const fresh = request.cookies.get(SESSION_COOKIE);
    expect(fresh).not.toBe(alice);
    expect((await findSession(fresh))?.id).toBe(ids[0]);
    expect(request.setCookie).toHaveBeenCalledWith(SESSION_COOKIE, fresh, expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 86400 }));
    expect(request.setCookie.mock.calls[0][2]).not.toHaveProperty("domain");
    expect(request.setCookie.mock.calls[0][2].expires.getTime()).toBeGreaterThan(Date.now());
  });
  it("logout revokes the server session and clears the cookie", async () => {
    request.cookies.set(SESSION_COOKIE, alice);
    await expect(logout()).rejects.toThrow("redirect:/login");
    expect(request.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(await findSession(alice)).toBeNull();
  });
  it("checks authorization inside the existing mutation, ignoring submitted owner IDs", async () => {
    await saveWorkspace(alice, "Alice private");
    const form = new FormData();
    form.set("name", "Attempted change");
    form.set("user_id", ids[0]);
    await expect(updateWorkspace({}, form)).rejects.toThrow("redirect:/login");
    request.cookies.set(SESSION_COOKIE, bob);
    expect((await updateWorkspace({}, form)).success).toBeTruthy();
    expect((await getWorkspace(alice))?.name).toBe("Alice private");
    expect((await getWorkspace(bob))?.name).toBe("Attempted change");
  });
  it("sanitizes database errors and fails closed", async () => {
    vi.spyOn(database(), "query").mockRejectedValueOnce(new Error("private connection details"));
    const state = await login({}, credentials(emails[0]));
    expect(state).toEqual({ error: "Unable to sign in right now. Please try again." });
    expect(request.cookies.has(SESSION_COOKIE)).toBe(false);
  });
  it("does not issue a session when the account is throttled", async () => {
    for (let i = 0; i < 10; i++) await recordFailedAuth(emails[0]);
    expect((await login({}, credentials(emails[0]))).error).toContain("Too many attempts");
    expect(request.cookies.has(SESSION_COOKIE)).toBe(false);
  });
  it("allows many successful logins in a row", async () => {
    for (let i = 0; i < 12; i++) await expect(login({}, credentials(emails[0]))).rejects.toThrow("redirect:/dashboard");
  });
  it("blocks even the correct password after 10 failed logins until the window resets", async () => {
    for (let i = 0; i < 10; i++) expect((await login({}, credentials(emails[0], "a wrong long password"))).error).toBe("Check your email and password.");
    expect((await login({}, credentials(emails[0]))).error).toContain("Too many attempts");
    expect(request.cookies.has(SESSION_COOKIE)).toBe(false);
    await database().query("UPDATE auth_limits SET reset_at = now() - interval '1 second' WHERE key = $1", [authLimitKey(emails[0])]);
    await expect(login({}, credentials(emails[0]))).rejects.toThrow("redirect:/dashboard");
  });
  it("resets the failure counter after a successful login", async () => {
    for (let i = 0; i < 9; i++) await login({}, credentials(emails[0], "a wrong long password"));
    await expect(login({}, credentials(emails[0]))).rejects.toThrow("redirect:/dashboard");
    const row = await database().query("SELECT 1 FROM auth_limits WHERE key = $1 AND reset_at > now()", [authLimitKey(emails[0])]);
    expect(row.rowCount).toBe(0);
    for (let i = 0; i < 9; i++) await login({}, credentials(emails[0], "a wrong long password"));
    await expect(login({}, credentials(emails[0]))).rejects.toThrow("redirect:/dashboard");
  });
  it("does not let registration attempts lock login for the same address", async () => {
    for (let i = 0; i < 10; i++) await register({}, credentials(emails[0], "a different test password"));
    expect((await register({}, credentials(emails[0]))).error).toContain("Too many attempts");
    await expect(login({}, credentials(emails[0]))).rejects.toThrow("redirect:/dashboard");
  });
});
