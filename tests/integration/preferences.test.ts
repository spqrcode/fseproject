import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { getReportingCurrency, saveReportingCurrency } from "@/lib/preferences-store";
import { updateReportingCurrency } from "@/app/actions/preferences";
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
let alice: string, bob: string;
function choose(currency: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("currency", currency);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}
async function storedCurrency(id: string) {
  return (await database().query<{ reporting_currency: string }>("SELECT reporting_currency FROM users WHERE id = $1", [id])).rows[0].reporting_currency;
}
beforeAll(async () => { await database().query("SELECT 1"); });
beforeEach(async () => {
  request.origin = "http://localhost:3100";
  request.cookies.clear();
  for (let index = 0; index < 2; index++) {
    const email = `preferences-${randomUUID()}@example.com`;
    emails.push(email);
    // The hash is never verified here; these accounts only need sessions.
    const result = await database().query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email]);
    ids.push(result.rows[0].id);
  }
  alice = (await createSession(ids[0])).token;
  bob = (await createSession(ids[1])).token;
});
afterEach(async () => {
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
  ids.length = 0;
});
afterAll(async () => { await database().end(); });

describe("reporting currency with a real database", () => {
  it("starts every account in EUR", async () => {
    expect(await getReportingCurrency(alice)).toBe("EUR");
    expect(await getReportingCurrency(bob)).toBe("EUR");
  });
  it("changes only the signed-in user's currency and survives a new session", async () => {
    request.cookies.set(SESSION_COOKIE, alice);
    expect(await updateReportingCurrency({}, choose("USD"))).toEqual({ success: "Reporting currency saved." });
    expect(await getReportingCurrency((await createSession(ids[0])).token)).toBe("USD");
    expect(await getReportingCurrency(bob)).toBe("EUR");
  });
  it("ignores a submitted user id and derives the owner from the session", async () => {
    request.cookies.set(SESSION_COOKIE, alice);
    await updateReportingCurrency({}, choose("GBP", { user_id: ids[1], userId: ids[1] }));
    expect(await storedCurrency(ids[0])).toBe("GBP");
    expect(await storedCurrency(ids[1])).toBe("EUR");
  });
  it.each(["usd", "SEK", "EURO", "", "EUR'; DROP TABLE users; --"])("rejects %j without changing data", async value => {
    request.cookies.set(SESSION_COOKIE, alice);
    expect((await updateReportingCurrency({}, choose(value))).error).toBe("Choose one of the listed currencies.");
    expect(await storedCurrency(ids[0])).toBe("EUR");
  });
  it("rejects a missing field and a file upload in place of the code", async () => {
    request.cookies.set(SESSION_COOKIE, alice);
    expect((await updateReportingCurrency({}, new FormData())).error).toBeTruthy();
    const form = new FormData();
    form.set("currency", new Blob(["USD"]), "currency.txt");
    expect((await updateReportingCurrency({}, form)).error).toBeTruthy();
    expect(await storedCurrency(ids[0])).toBe("EUR");
  });
  it.each([null, "https://untrusted.example"])("rejects missing or foreign origin without changing data: %s", async origin => {
    request.cookies.set(SESSION_COOKIE, alice);
    request.origin = origin;
    expect((await updateReportingCurrency({}, choose("JPY"))).error).toBe("Unable to save your settings. Please try again.");
    expect(await storedCurrency(ids[0])).toBe("EUR");
  });
  it("sends anonymous, unknown and expired sessions to sign in", async () => {
    await expect(updateReportingCurrency({}, choose("USD"))).rejects.toThrow("redirect:/login");
    request.cookies.set(SESSION_COOKIE, "a".repeat(64));
    await expect(updateReportingCurrency({}, choose("USD"))).rejects.toThrow("redirect:/login");
    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [ids[0]]);
    request.cookies.set(SESSION_COOKIE, alice);
    await expect(updateReportingCurrency({}, choose("USD"))).rejects.toThrow("redirect:/login");
    expect(await storedCurrency(ids[0])).toBe("EUR");
  });
  it("store functions refuse missing, malformed, unknown and expired tokens", async () => {
    for (const token of [undefined, "not-a-token", "b".repeat(64)]) {
      expect(await getReportingCurrency(token)).toBeNull();
      await expect(saveReportingCurrency(token, "USD")).rejects.toThrow("Authentication required.");
    }
    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [ids[1]]);
    expect(await getReportingCurrency(bob)).toBeNull();
    await expect(saveReportingCurrency(bob, "USD")).rejects.toThrow("Authentication required.");
    expect(await storedCurrency(ids[1])).toBe("EUR");
  });
  it("validates the code in the store too, before any SQL runs", async () => {
    const query = vi.spyOn(database(), "query");
    await expect(saveReportingCurrency(alice, "usd")).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });
  it("the database refuses malformed codes even when the application is bypassed", async () => {
    for (const value of ["usd", "EURO", "E1R", ""]) {
      await expect(database().query("UPDATE users SET reporting_currency = $2 WHERE id = $1", [ids[0], value])).rejects.toMatchObject({ code: "23514" });
    }
    await expect(database().query("UPDATE users SET reporting_currency = NULL WHERE id = $1", [ids[0]])).rejects.toMatchObject({ code: "23502" });
  });
  it("falls back to the default when a stored code is no longer offered", async () => {
    await database().query("UPDATE users SET reporting_currency = 'SEK' WHERE id = $1", [ids[0]]);
    expect(await getReportingCurrency(alice)).toBe("EUR");
  });
});
