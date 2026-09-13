import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession, findSession, revokeSession, tokenHash } from "@/lib/session-store";
import { savePortfolio, getPortfolio } from "@/lib/portfolio-store";
import { allowAuthAttempt, authLimitKey } from "@/lib/rate-limit";
import { register, login, logout } from "@/app/actions/auth";
import { updatePortfolio } from "@/app/actions/portfolio";
import { listHoldings, createHolding, updateHolding, deleteHolding } from "@/lib/holdings-store";
import { addHolding, editHolding, removeHolding } from "@/app/actions/holdings";
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
  await database().query("DELETE FROM auth_limits WHERE key = ANY($1::text[])", [emails.map(authLimitKey)]);
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
  it("isolates the existing portfolio operations across two users", async () => {
    await savePortfolio(alice, "Alice portfolio");
    expect(await getPortfolio(bob)).toBeNull();
    await savePortfolio(bob, "Bob portfolio");
    await savePortfolio(bob, "Bob renamed");
    expect((await getPortfolio(alice))?.name).toBe("Alice portfolio");
    expect((await getPortfolio(bob))?.name).toBe("Bob renamed");
    const count = await database().query("SELECT count(*)::int AS count FROM portfolios WHERE user_id = $1", [ids[1]]);
    expect(count.rows[0].count).toBe(1);
  });
  it("rejects anonymous, unknown-token and invalid writes", async () => {
    expect(await getPortfolio(undefined)).toBeNull();
    expect(await getPortfolio("0".repeat(64))).toBeNull();
    await expect(savePortfolio(undefined, "forged")).rejects.toThrow();
    await expect(savePortfolio("0".repeat(64), "forged")).rejects.toThrow();
    await expect(savePortfolio(alice, " ")).rejects.toThrow();
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
  it("enforces email uniqueness and portfolio constraints in SQL", async () => {
    await expect(database().query("INSERT INTO users(email,password_hash) VALUES($1,$2)", [emails[0], passwordHash])).rejects.toMatchObject({ code: "23505" });
    await savePortfolio(alice, "Valid");
    await expect(database().query("INSERT INTO portfolios(user_id,name) VALUES($1,'duplicate')", [ids[0]])).rejects.toMatchObject({ code: "23505" });
    await expect(database().query("UPDATE portfolios SET name = ' ' WHERE user_id = $1", [ids[0]])).rejects.toMatchObject({ code: "23514" });
  });
  it("treats SQL-looking input as data", async () => {
    const name = "Robert'); DROP TABLE users; --";
    await savePortfolio(alice, name);
    expect((await getPortfolio(alice))?.name).toBe(name);
    expect(await findSession(bob)).not.toBeNull();
  });
  it("expiry blocks identity, reads, and writes despite an existing cookie", async () => {
    await savePortfolio(alice, "Private");
    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [tokenHash(alice)]);
    request.cookies.set(SESSION_COOKIE, alice);
    expect(await findSession(alice)).toBeNull();
    expect(await getPortfolio(alice)).toBeNull();
    await expect(savePortfolio(alice, "forged")).rejects.toThrow();
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
  it("revocation prevents replay without revoking another user's session", async () => {
    await revokeSession(alice);
    expect(await findSession(alice)).toBeNull();
    await expect(savePortfolio(alice, "replay")).rejects.toThrow();
    expect(await findSession(bob)).not.toBeNull();
  });
});

describe("authentication throttle", () => {
  it("allows exactly ten simultaneous attempts per normalized address", async () => {
    const email = uniqueEmail();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => allowAuthAttempt(i % 2 ? ` ${email.toUpperCase()} ` : email)));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await allowAuthAttempt(uniqueEmail())).toBe(true);
  });
  it("does not have an application-wide lockout after 100 requests", async () => {
    for (let i = 0; i < 105; i++) expect(await allowAuthAttempt(uniqueEmail())).toBe(true);
    expect(await allowAuthAttempt(uniqueEmail())).toBe(true);
  });
  it("resets an expired window and does not extend it for blocked attempts", async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 10; i++) await allowAuthAttempt(email);
    const before = await database().query("SELECT reset_at FROM auth_limits WHERE key=$1", [authLimitKey(email)]);
    expect(await allowAuthAttempt(email)).toBe(false);
    const after = await database().query("SELECT reset_at FROM auth_limits WHERE key=$1", [authLimitKey(email)]);
    expect(after.rows[0].reset_at).toEqual(before.rows[0].reset_at);
    await database().query("UPDATE auth_limits SET reset_at=now()-interval '1 second' WHERE key=$1", [authLimitKey(email)]);
    expect(await allowAuthAttempt(email)).toBe(true);
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
    await savePortfolio(alice, "Alice private");
    const form = new FormData();
    form.set("name", "Attempted change");
    form.set("user_id", ids[0]);
    await expect(updatePortfolio({}, form)).rejects.toThrow("redirect:/login");
    request.cookies.set(SESSION_COOKIE, bob);
    expect((await updatePortfolio({}, form)).success).toBeTruthy();
    expect((await getPortfolio(alice))?.name).toBe("Alice private");
    expect((await getPortfolio(bob))?.name).toBe("Attempted change");
  });
  it("sanitizes database errors and fails closed", async () => {
    vi.spyOn(database(), "query").mockRejectedValueOnce(new Error("private connection details"));
    const state = await login({}, credentials(emails[0]));
    expect(state).toEqual({ error: "Unable to sign in right now. Please try again." });
    expect(request.cookies.has(SESSION_COOKIE)).toBe(false);
  });
  it("does not issue a session when the account is throttled", async () => {
    for (let i = 0; i < 10; i++) await allowAuthAttempt(emails[0]);
    expect((await login({}, credentials(emails[0]))).error).toContain("Too many attempts");
    expect(request.cookies.has(SESSION_COOKIE)).toBe(false);
  });
});

const APPLE = { symbol: "AAPL", quantity: "10", averageBuyPrice: "185.40" };
function holdingForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}
async function only(token: string) {
  const holdings = await listHoldings(token);
  expect(holdings).toHaveLength(1);
  return holdings[0];
}

describe("holdings persistence and validation", () => {
  beforeEach(async () => { await savePortfolio(alice, "Alice portfolio"); });

  it("creates, lists, updates and deletes a holding for its owner", async () => {
    await createHolding(alice, APPLE);
    const created = await only(alice);
    expect(created).toMatchObject({ symbol: "AAPL", quantity: "10.00000000", average_buy_price: "185.40000000" });
    await updateHolding(alice, created.id, { symbol: "msft", quantity: "2.5", averageBuyPrice: "300" });
    const updated = await only(alice);
    expect(updated).toMatchObject({ id: created.id, symbol: "MSFT", quantity: "2.50000000", average_buy_price: "300.00000000" });
    expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());
    await deleteHolding(alice, created.id);
    expect(await listHoldings(alice)).toEqual([]);
  });

  it("rejects a duplicate ticker in the same portfolio but allows it in another user's", async () => {
    await savePortfolio(bob, "Bob portfolio");
    await createHolding(alice, APPLE);
    await expect(createHolding(alice, { ...APPLE, quantity: "1" })).rejects.toMatchObject({ reason: "duplicate" });
    await expect(createHolding(alice, { ...APPLE, symbol: "aapl" })).rejects.toMatchObject({ reason: "duplicate" });
    expect(await listHoldings(alice)).toHaveLength(1);
    await createHolding(bob, APPLE);
    expect((await only(bob)).symbol).toBe("AAPL");
    await createHolding(alice, { ...APPLE, symbol: "MSFT" });
    const first = (await listHoldings(alice))[0];
    await expect(updateHolding(alice, first.id, { ...APPLE, symbol: "MSFT" })).rejects.toMatchObject({ reason: "duplicate" });
  });

  it("refuses non-finite, non-positive and oversized values before writing", async () => {
    for (const quantity of ["NaN", "Infinity", "-5", "0", "1e3"]) {
      await expect(createHolding(alice, { ...APPLE, quantity })).rejects.toThrow();
    }
    await expect(createHolding(alice, { ...APPLE, averageBuyPrice: "1000000001" })).rejects.toThrow();
    await expect(createHolding(alice, { ...APPLE, symbol: "not a ticker" })).rejects.toThrow();
    expect(await listHoldings(alice)).toEqual([]);
  });

  it("stops the database accepting NaN or a non-positive amount even without the form", async () => {
    const portfolio = await getPortfolio(alice);
    for (const value of ["NaN", "0", "-1"]) {
      await expect(database().query("INSERT INTO holdings(portfolio_id,symbol,quantity,average_buy_price) VALUES ($1,'AAPL',$2,1)",
        [portfolio!.id, value])).rejects.toMatchObject({ code: "23514" });
    }
    await expect(database().query("INSERT INTO holdings(portfolio_id,symbol,quantity,average_buy_price) VALUES ($1,'aapl',1,1)",
      [portfolio!.id])).rejects.toMatchObject({ code: "23514" });
  });

  it("removes holdings with the portfolio and the account", async () => {
    await createHolding(alice, APPLE);
    await database().query("DELETE FROM users WHERE id = $1", [ids[0]]);
    const remaining = await database().query("SELECT 1 FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id WHERE p.user_id = $1", [ids[0]]);
    expect(remaining.rowCount).toBe(0);
  });
});

describe("holdings ownership isolation", () => {
  let aliceHolding: string;
  beforeEach(async () => {
    await savePortfolio(alice, "Alice portfolio");
    await savePortfolio(bob, "Bob portfolio");
    await createHolding(alice, APPLE);
    aliceHolding = (await only(alice)).id;
  });

  it("never lists another user's holdings", async () => {
    expect(await listHoldings(bob)).toEqual([]);
    expect(await listHoldings(undefined)).toEqual([]);
    expect(await listHoldings("0".repeat(64))).toEqual([]);
  });

  it("refuses anonymous and unknown-token writes", async () => {
    for (const token of [undefined, "0".repeat(64), "not-a-token"]) {
      await expect(createHolding(token, APPLE)).rejects.toThrow();
      await expect(updateHolding(token, aliceHolding, APPLE)).rejects.toThrow();
      await expect(deleteHolding(token, aliceHolding)).rejects.toThrow();
    }
    expect(await listHoldings(alice)).toHaveLength(1);
  });

  it("gives the same answer for another user's holding id and one that does not exist", async () => {
    const unknown = randomUUID();
    await expect(updateHolding(bob, aliceHolding, { ...APPLE, quantity: "999" })).rejects.toMatchObject({ reason: "not-found" });
    await expect(updateHolding(bob, unknown, APPLE)).rejects.toMatchObject({ reason: "not-found" });
    await expect(deleteHolding(bob, aliceHolding)).rejects.toMatchObject({ reason: "not-found" });
    await expect(deleteHolding(bob, unknown)).rejects.toMatchObject({ reason: "not-found" });
    await expect(deleteHolding(bob, "../../etc/passwd")).rejects.toMatchObject({ reason: "not-found" });
    const survivor = await only(alice);
    expect(survivor).toMatchObject({ id: aliceHolding, quantity: "10.00000000" });
  });

  it("ignores a submitted portfolio id when adding", async () => {
    const alicePortfolio = (await getPortfolio(alice))!.id;
    request.cookies.set(SESSION_COOKIE, bob);
    const state = await addHolding({}, holdingForm({ ...APPLE, symbol: "MSFT", portfolio_id: alicePortfolio }));
    expect(state.success).toBeTruthy();
    expect((await listHoldings(alice)).map(h => h.symbol)).toEqual(["AAPL"]);
    expect((await only(bob)).symbol).toBe("MSFT");
  });

  it("cannot move a holding into another portfolio through the edit form", async () => {
    const bobPortfolio = (await getPortfolio(bob))!.id;
    request.cookies.set(SESSION_COOKIE, alice);
    const state = await editHolding({}, holdingForm({ ...APPLE, quantity: "4", id: aliceHolding, portfolio_id: bobPortfolio }));
    expect(state.success).toBeTruthy();
    expect(await listHoldings(bob)).toEqual([]);
    const row = await database().query("SELECT portfolio_id, quantity FROM holdings WHERE id = $1", [aliceHolding]);
    expect(row.rows[0].portfolio_id).not.toBe(bobPortfolio);
    expect(row.rows[0].quantity).toBe("4.00000000");
  });

  it("returns an unhelpful message and changes nothing when another user forges an id", async () => {
    request.cookies.set(SESSION_COOKIE, bob);
    const forged = holdingForm({ ...APPLE, quantity: "999", id: aliceHolding });
    expect(await editHolding({}, forged)).toEqual({ error: "That holding is no longer available." });
    expect(await removeHolding({}, holdingForm({ id: aliceHolding }))).toEqual({ error: "That holding is no longer available." });
    expect(await removeHolding({}, holdingForm({ id: randomUUID() }))).toEqual({ error: "That holding is no longer available." });
    expect(await removeHolding({}, holdingForm({ id: "1 OR 1=1" }))).toEqual({ error: "That holding is no longer available." });
    expect(await only(alice)).toMatchObject({ quantity: "10.00000000" });
  });

  it("blocks every operation once the session has expired", async () => {
    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [tokenHash(alice)]);
    expect(await listHoldings(alice)).toEqual([]);
    await expect(createHolding(alice, { ...APPLE, symbol: "MSFT" })).rejects.toMatchObject({ reason: "no-portfolio" });
    await expect(updateHolding(alice, aliceHolding, APPLE)).rejects.toMatchObject({ reason: "not-found" });
    await expect(deleteHolding(alice, aliceHolding)).rejects.toMatchObject({ reason: "not-found" });
    const row = await database().query("SELECT quantity FROM holdings WHERE id = $1", [aliceHolding]);
    expect(row.rows[0].quantity).toBe("10.00000000");
  });

  it("requires an authenticated session in the server actions themselves", async () => {
    await expect(addHolding({}, holdingForm(APPLE))).rejects.toThrow("redirect:/login");
    await expect(editHolding({}, holdingForm({ ...APPLE, id: aliceHolding }))).rejects.toThrow("redirect:/login");
    await expect(removeHolding({}, holdingForm({ id: aliceHolding }))).rejects.toThrow("redirect:/login");
  });

  it.each([null, "https://untrusted.example"])("rejects a missing or foreign origin: %s", async origin => {
    request.cookies.set(SESSION_COOKIE, bob);
    request.origin = origin;
    expect((await addHolding({}, holdingForm({ ...APPLE, symbol: "MSFT" }))).error).toBeTruthy();
    expect(await listHoldings(bob)).toEqual([]);
  });

  it("asks the user to create a portfolio instead of failing silently", async () => {
    const fresh = await database().query("INSERT INTO users(email,password_hash) VALUES ($1,$2) RETURNING id", [uniqueEmail(), passwordHash]);
    ids.push(fresh.rows[0].id);
    const token = (await createSession(fresh.rows[0].id)).token;
    request.cookies.set(SESSION_COOKIE, token);
    expect(await addHolding({}, holdingForm(APPLE))).toEqual({ error: "Create a portfolio before adding holdings." });
  });
});
