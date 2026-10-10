import { beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ZodError } from "zod";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { saveDangerThreshold, saveWorkspace } from "@/lib/workspace-store";
import { createCashAccount, createCashEvent, setCashEventStatus } from "@/lib/cash-events-store";
import { getForecastInput } from "@/lib/forecast-input-store";

// Same connection rules as cash-events.test.ts: fixtures may use an owner connection while the application
// connects as the restricted staging role. Every connection must point at a _test database.
const testDatabase = (value: string | undefined) => !!value && new URL(value).pathname.endsWith("_test");
const fixturesUrl = process.env.TEST_FIXTURES_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!testDatabase(process.env.DATABASE_URL) || !testDatabase(fixturesUrl) || (!process.env.TEST_FIXTURES_DATABASE_URL && process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}
const fixtures = new Pool({ connectionString: fixturesUrl, max: 2 });

type Person = { id: string; token: string; accountId: string; otherAccountId: string; workspaceId: string };
const emails: string[] = [];
let alice: Person, bob: Person;
const START = "2026-10-01";
const END = "2026-10-31";

async function person(name: string): Promise<Person> {
  const email = `forecast-${name}-${randomUUID()}@example.com`;
  emails.push(email);
  const id = (await fixtures.query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email])).rows[0].id as string;
  const { token } = await createSession(id);
  await saveWorkspace(token, `${name} workspace`);
  const workspaceId = (await fixtures.query("SELECT id FROM workspaces WHERE user_id = $1", [id])).rows[0].id as string;
  const main = (await createCashAccount(token, { name: "Main", currency: "EUR", openingBalance: "1000.00" }))!.id;
  const other = (await createCashAccount(token, { name: "Other", currency: "USD", openingBalance: "50.00" }))!.id;
  return { id, token, accountId: main, otherAccountId: other, workspaceId };
}
// Events are inserted directly so that every status and date can be set, including ones the store's rules
// (settling moves a future date to today) would never produce.
async function insert(p: Person, accountId: string, amount: string, status: string, date: string, description = "event") {
  return (await fixtures.query(`INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date, status)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [p.workspaceId, accountId, description, amount, date, status])).rows[0].id as string;
}
async function utcDay(offset: number) {
  return (await fixtures.query("SELECT to_char((now() AT TIME ZONE 'UTC')::date + $1::int, 'YYYY-MM-DD') AS day", [offset])).rows[0].day as string;
}
const forecast = (p: Person, over: Partial<{ accountId: unknown; startDate: unknown; endDate: unknown }> = {}) =>
  getForecastInput(p.token, { accountId: p.accountId, startDate: START, endDate: END, ...over });

beforeEach(async () => { alice = await person("alice"); bob = await person("bob"); });
afterEach(async () => {
  await fixtures.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
});
afterAll(async () => { await fixtures.end(); await database().end(); });

describe("starting balance", () => {
  it("is the opening balance plus received and paid events dated before the start date, and nothing else", async () => {
    await insert(alice, alice.accountId, "100.00", "received", "2026-09-15");
    await insert(alice, alice.accountId, "-200.00", "paid", "2026-09-30");
    await insert(alice, alice.accountId, "50.00", "received", START);          // on the start date: not before it
    await insert(alice, alice.accountId, "-30.00", "paid", "2026-10-02");     // after the start date
    await insert(alice, alice.accountId, "-999.00", "cancelled", "2026-09-10");
    await insert(alice, alice.accountId, "-70.00", "expected", "2026-09-10");  // overdue, but not money that moved
    await insert(alice, alice.otherAccountId, "-7.00", "paid", "2026-09-10");  // another account of the same workspace
    await insert(bob, bob.accountId, "-5.00", "paid", "2026-09-10");           // another user
    const input = (await forecast(alice))!;
    expect(input.startingBalance).toBe("900.00");
    expect(input.account).toEqual({ id: alice.accountId, name: "Main", currency: "EUR" });
    expect((await forecast(alice, { accountId: alice.otherAccountId }))!.startingBalance).toBe("43.00");
  });
  it("is computed exactly in the database, not with JavaScript numbers", async () => {
    const big = (await createCashAccount(alice.token, { name: "Big", currency: "SGD", openingBalance: "999999999999999999.99" }))!;
    await insert(alice, big.id, "-0.01", "paid", "2026-09-01");
    await insert(alice, big.id, "-0.10", "paid", "2026-09-02");
    expect((await forecast(alice, { accountId: big.id }))!.startingBalance).toBe("999999999999999999.88");
  });
  it("equals the opening balance, and the list is empty, for an account without events", async () => {
    expect(await forecast(alice)).toMatchObject({ startingBalance: "1000.00", events: [], dangerThreshold: null });
    const negative = (await createCashAccount(alice.token, { name: "Overdrawn", currency: "EUR", openingBalance: "-50.5" }))!;
    expect((await forecast(alice, { accountId: negative.id }))!.startingBalance).toBe("-50.50");
  });
  it("includes an event that was settled early, because settling moves its date to today", async () => {
    const day = (offset: number) => utcDay(offset);
    const start = await day(1), end = await day(40);
    const early = (await createCashEvent(alice.token, alice.accountId, { description: "Early", amount: "-300", expectedDate: await day(10) }))!;
    const before = (await getForecastInput(alice.token, { accountId: alice.accountId, startDate: start, endDate: end }))!;
    expect(before.startingBalance).toBe("1000.00");
    expect(before.events.map(e => e.id)).toEqual([early.id]);
    await setCashEventStatus(alice.token, early.id, "paid");
    const after = (await getForecastInput(alice.token, { accountId: alice.accountId, startDate: start, endDate: end }))!;
    expect(after.startingBalance).toBe("700.00");
    expect(after.events).toEqual([]);
  });
});

describe("forecast events", () => {
  it("lists only expected events up to the end date and moves overdue ones to the start date", async () => {
    const overdue = await insert(alice, alice.accountId, "-80.00", "expected", "2026-09-20", "Overdue");
    const onStart = await insert(alice, alice.accountId, "10.00", "expected", START, "On start");
    const inside = await insert(alice, alice.accountId, "-20.00", "expected", "2026-10-15", "Inside");
    const onEnd = await insert(alice, alice.accountId, "5.00", "expected", END, "On end");
    await insert(alice, alice.accountId, "-1.00", "expected", "2026-11-01", "After end");
    await insert(alice, alice.accountId, "-2.00", "cancelled", "2026-10-10", "Cancelled");
    await insert(alice, alice.accountId, "-3.00", "paid", "2026-10-10", "Paid");
    await insert(alice, alice.accountId, "3.00", "received", "2026-10-10", "Received");
    await insert(alice, alice.otherAccountId, "-4.00", "expected", "2026-10-10", "Other account");
    await insert(bob, bob.accountId, "-6.00", "expected", "2026-10-10", "Bob");
    const events = (await forecast(alice))!.events;
    expect(events.map(e => [e.id, e.expectedDate, e.originalDate, e.overdue])).toEqual([
      [overdue, START, "2026-09-20", true],
      [onStart, START, START, false],
      [inside, "2026-10-15", "2026-10-15", false],
      [onEnd, END, END, false],
    ]);
    expect(events.find(e => e.id === overdue)).toMatchObject({ description: "Overdue", amount: "-80.00" });
  });
  it("gives createdAt as UTC text with milliseconds and a Z", async () => {
    const id = await insert(alice, alice.accountId, "-1.00", "expected", "2026-10-10");
    const [event] = (await forecast(alice))!.events;
    expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const stored = (await fixtures.query("SELECT created_at FROM cash_events WHERE id = $1", [id])).rows[0].created_at as Date;
    expect(event.createdAt).toBe(stored.toISOString());
  });
  it("orders by the date the forecast uses, then creation time", async () => {
    const late = await insert(alice, alice.accountId, "-1.00", "expected", "2026-10-20");
    const overdue = await insert(alice, alice.accountId, "-1.00", "expected", "2026-08-01");
    const early = await insert(alice, alice.accountId, "-1.00", "expected", "2026-10-05");
    expect((await forecast(alice))!.events.map(e => e.id)).toEqual([overdue, early, late]);
  });
});

describe("danger threshold", () => {
  it("is null until the workspace sets one, then the stored value; another user's value is not shown", async () => {
    expect((await forecast(alice))!.dangerThreshold).toBeNull();
    await saveDangerThreshold(alice.token, "250.5");
    await saveDangerThreshold(bob.token, "9");
    expect((await forecast(alice))!.dangerThreshold).toBe("250.50");
    expect((await forecast(bob))!.dangerThreshold).toBe("9.00");
  });
});

describe("ownership and validation", () => {
  it("gives the same null for another user's account, an unknown id and a malformed id", async () => {
    await insert(alice, alice.accountId, "-1.00", "expected", "2026-10-10");
    const foreign = await getForecastInput(bob.token, { accountId: alice.accountId, startDate: START, endDate: END });
    const unknown = await getForecastInput(bob.token, { accountId: randomUUID(), startDate: START, endDate: END });
    expect(foreign).toBeNull();
    expect(foreign).toEqual(unknown);
    for (const accountId of ["not-a-uuid", "", "' OR '1'='1", undefined, 7]) expect(await forecast(bob, { accountId })).toBeNull();
  });
  it.each([undefined, "", "bad", "0".repeat(64)])("throws for the session %j", async token => {
    await expect(getForecastInput(token, { accountId: alice.accountId, startDate: START, endDate: END })).rejects.toThrow("Authentication required.");
    await expect(getForecastInput(token, { accountId: "not-a-uuid", startDate: START, endDate: END })).rejects.toThrow("Authentication required.");
  });
  it("throws for an expired session", async () => {
    await fixtures.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [alice.id]);
    await expect(forecast(alice)).rejects.toThrow("Authentication required.");
  });
  it.each([
    ["start after end", "2026-10-02", "2026-10-01"],
    ["367 days", "2026-10-01", "2027-10-03"],
    ["before 2000", "1999-12-31", "2000-01-02"],
    ["after 2100", "2100-12-30", "2101-01-01"],
    ["impossible day", "2026-02-30", "2026-03-05"],
    ["wrong format", "2026-10-01", "31.10.2026"],
  ])("rejects the range %s before looking at the session", async (_name, startDate, endDate) => {
    await expect(forecast(alice, { startDate, endDate })).rejects.toBeInstanceOf(ZodError);
    await expect(getForecastInput(undefined, { accountId: alice.accountId, startDate, endDate })).rejects.toBeInstanceOf(ZodError);
  });
  it("accepts a range of exactly 366 days and a single day", async () => {
    expect(await forecast(alice, { startDate: "2026-10-01", endDate: "2027-10-02" })).not.toBeNull();
    expect(await forecast(alice, { startDate: "2026-10-01", endDate: "2026-10-01" })).not.toBeNull();
  });
  it("does not leave a connection in a transaction after a failure or a miss", async () => {
    for (let i = 0; i < 12; i++) await forecast(bob, { accountId: randomUUID() });
    expect(await forecast(alice)).not.toBeNull();
  });
});
