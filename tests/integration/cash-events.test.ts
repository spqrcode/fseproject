import { beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { getDangerThreshold, saveDangerThreshold, saveWorkspace } from "@/lib/workspace-store";
import {
  DuplicateAccountNameError, StatusConflictError, createCashAccount, createCashEvent, deleteCashEvent,
  listCashAccounts, listCashEvents, renameCashAccount, setCashEventStatus, updateCashEvent,
} from "@/lib/cash-events-store";

// Normally the application and the fixtures share TEST_DATABASE_URL. With TEST_FIXTURES_DATABASE_URL the
// application connects as a restricted role (DATABASE_URL) while fixtures (users, expiry changes, cleanup)
// use a separate owner connection. Every connection must point at a database whose name ends in _test.
const testDatabase = (value: string | undefined) => !!value && new URL(value).pathname.endsWith("_test");
const fixturesUrl = process.env.TEST_FIXTURES_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!testDatabase(process.env.DATABASE_URL) || !testDatabase(fixturesUrl) || (!process.env.TEST_FIXTURES_DATABASE_URL && process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}
const fixtures = new Pool({ connectionString: fixturesUrl, max: 2 });

type Person = { email: string; id: string; token: string; workspaceId: string; accountId: string; eventId: string };
const emails: string[] = [];
let alice: Person, bob: Person;
const rent = { description: "Rent", amount: "-1200.00", expectedDate: "2026-10-01" };
const salary = { description: "Salary", amount: "3000.00", expectedDate: "2026-10-28" };

async function person(name: string, withWorkspace = true): Promise<Person> {
  const email = `cash-${name}-${randomUUID()}@example.com`;
  emails.push(email);
  const user = await fixtures.query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email]);
  const id = user.rows[0].id as string;
  const { token } = await createSession(id);
  const me: Person = { email, id, token, workspaceId: "", accountId: "", eventId: "" };
  if (!withWorkspace) return me;
  await saveWorkspace(token, `${name} workspace`);
  me.workspaceId = (await fixtures.query("SELECT id FROM workspaces WHERE user_id = $1", [id])).rows[0].id;
  me.accountId = (await createCashAccount(token, { name: "Main", currency: "EUR", openingBalance: "1000.00" }))!.id;
  me.eventId = (await createCashEvent(token, me.accountId, rent))!.id;
  return me;
}
async function eventRow(id: string) {
  return (await fixtures.query("SELECT description, amount::text AS amount, expected_date::text AS expected_date, status FROM cash_events WHERE id = $1", [id])).rows[0];
}
async function count(table: string, column: string, value: string) {
  return (await fixtures.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} = $1`, [value])).rows[0].count as number;
}
function rawEvent(p: Person, amount: string, status: string, accountId = p.accountId, workspaceId = p.workspaceId, date = "2026-10-05") {
  return database().query("INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date, status) VALUES ($1,$2,'raw',$3,$4,$5)",
    [workspaceId, accountId, amount, date, status]);
}

beforeEach(async () => { alice = await person("alice"); bob = await person("bob"); });
afterEach(async () => {
  await fixtures.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
});
afterAll(async () => { await fixtures.end(); await database().end(); });

describe("database constraints, bypassing the application", () => {
  const check = { code: "23514" };
  it.each([["zero", "0"], ["NaN", "NaN"]])("rejects an event amount of %s", async (_name, amount) => {
    await expect(rawEvent(alice, amount, "expected")).rejects.toMatchObject(check);
  });
  it("rejects Infinity and amounts beyond 18 integer digits", async () => {
    await expect(rawEvent(alice, "Infinity", "expected")).rejects.toMatchObject({ code: "22003" });
    await expect(rawEvent(alice, "1000000000000000000", "expected")).rejects.toMatchObject({ code: "22003" });
  });
  it("rejects received with a negative amount, paid with a positive one, and an unknown status", async () => {
    await expect(rawEvent(alice, "-5", "received")).rejects.toMatchObject(check);
    await expect(rawEvent(alice, "5", "paid")).rejects.toMatchObject(check);
    await expect(rawEvent(alice, "5", "late")).rejects.toMatchObject(check);
    await expect(rawEvent(alice, "5", "received")).resolves.toBeTruthy();
    await expect(rawEvent(alice, "-5", "paid")).resolves.toBeTruthy();
    await expect(rawEvent(alice, "-5", "cancelled")).resolves.toBeTruthy();
  });
  it("rejects an infinite date", async () => {
    await expect(rawEvent(alice, "5", "expected", alice.accountId, alice.workspaceId, "infinity")).rejects.toMatchObject(check);
  });
  it("rejects a currency outside EUR, USD and SGD and a NaN opening balance", async () => {
    const insert = (currency: string, balance: string, name: string) => database().query(
      "INSERT INTO cash_accounts(workspace_id, name, currency, opening_balance) VALUES ($1,$2,$3,$4)", [alice.workspaceId, name, currency, balance]);
    await expect(insert("GBP", "0", "a")).rejects.toMatchObject(check);
    await expect(insert("eur", "0", "b")).rejects.toMatchObject(check);
    await expect(insert("EUR", "NaN", "c")).rejects.toMatchObject(check);
    await expect(insert("SGD", "-50.25", "d")).resolves.toBeTruthy();
  });
  it("rejects untrimmed or empty names and descriptions", async () => {
    const account = (name: string) => database().query("INSERT INTO cash_accounts(workspace_id, name, currency, opening_balance) VALUES ($1,$2,'EUR',0)", [alice.workspaceId, name]);
    for (const name of ["", " ", " padded", "a".repeat(81)]) await expect(account(name)).rejects.toMatchObject(check);
    await expect(database().query("UPDATE cash_events SET description = ' x' WHERE id = $1", [alice.eventId])).rejects.toMatchObject(check);
  });
  it("rejects a NaN danger threshold but accepts NULL, zero and negative values", async () => {
    const set = (value: string | null) => database().query("UPDATE workspaces SET danger_threshold = $2 WHERE id = $1", [alice.workspaceId, value]);
    await expect(set("NaN")).rejects.toMatchObject(check);
    for (const value of [null, "0", "-250.50"]) await expect(set(value)).resolves.toBeTruthy();
  });
  it("rejects an event that points at another workspace's account, however the ids are combined", async () => {
    const foreignFk = { code: "23503" };
    await expect(rawEvent(alice, "5", "expected", bob.accountId, alice.workspaceId)).rejects.toMatchObject(foreignFk);
    await expect(rawEvent(alice, "5", "expected", bob.accountId, bob.workspaceId)).resolves.toBeTruthy();
    // Through the owner connection: the restricted runtime role cannot even try, it has no UPDATE on account_id.
    await expect(fixtures.query("UPDATE cash_events SET account_id = $2 WHERE id = $1", [alice.eventId, bob.accountId])).rejects.toMatchObject(foreignFk);
  });
  it("keeps account names unique per workspace only", async () => {
    await expect(database().query("INSERT INTO cash_accounts(workspace_id, name, currency, opening_balance) VALUES ($1,'Main','USD',0)", [alice.workspaceId])).rejects.toMatchObject({ code: "23505" });
    expect(await listCashAccounts(bob.token)).toHaveLength(1);
  });
});

describe("accounts and events through the store", () => {
  it("round-trips amounts, currency from the account and a date-only value", async () => {
    const usd = (await createCashAccount(alice.token, { name: "  Dollar  ", currency: "USD", openingBalance: "-20.5" }))!;
    expect(usd).toMatchObject({ name: "Dollar", currency: "USD", openingBalance: "-20.50" });
    const created = (await createCashEvent(alice.token, usd.id, { description: "  Invoice ", amount: "99.9", expectedDate: "2026-03-29" }))!;
    expect(created).toMatchObject({ description: "Invoice", amount: "99.90", currency: "USD", expectedDate: "2026-03-29", status: "expected", accountId: usd.id });
    expect((await listCashEvents(alice.token)).find(e => e.id === created.id)).toEqual(created);
  });
  it("lists by inclusive date range in date order and returns every status", async () => {
    await createCashEvent(alice.token, alice.accountId, salary);
    const cancelled = (await createCashEvent(alice.token, alice.accountId, { ...rent, description: "Gym", expectedDate: "2026-10-15" }))!;
    await setCashEventStatus(alice.token, cancelled.id, "cancelled");
    expect((await listCashEvents(alice.token)).map(e => e.expectedDate)).toEqual(["2026-10-01", "2026-10-15", "2026-10-28"]);
    expect((await listCashEvents(alice.token, { from: "2026-10-01", to: "2026-10-15" })).map(e => e.expectedDate)).toEqual(["2026-10-01", "2026-10-15"]);
    expect((await listCashEvents(alice.token, { from: "2026-10-02" })).map(e => e.description)).toEqual(["Gym", "Salary"]);
    expect((await listCashEvents(alice.token)).map(e => e.status)).toContain("cancelled");
    await expect(listCashEvents(alice.token, { from: "2026-02-30" })).rejects.toThrow();
  });
  it("rejects invalid input before it reaches the database", async () => {
    for (const input of [{ ...rent, amount: "0" }, { ...rent, amount: "1.234" }, { ...rent, amount: "NaN" }, { ...rent, amount: "1e3" }, { ...rent, expectedDate: "2026-02-30" }, { ...rent, description: " " }])
      await expect(createCashEvent(alice.token, alice.accountId, input)).rejects.toThrow();
    await expect(createCashAccount(alice.token, { name: "X", currency: "GBP", openingBalance: "0" })).rejects.toThrow();
    await expect(createCashAccount(alice.token, { name: "X", currency: "EUR", openingBalance: "NaN" })).rejects.toThrow();
    expect(await count("cash_events", "workspace_id", alice.workspaceId)).toBe(1);
  });
  it("updates description, amount and date only", async () => {
    const updated = (await updateCashEvent(alice.token, alice.eventId, { description: "Rent Nov", amount: "-1300", expectedDate: "2026-11-01", accountId: bob.accountId, status: "paid" }))!;
    expect(updated).toMatchObject({ description: "Rent Nov", amount: "-1300.00", expectedDate: "2026-11-01", status: "expected", accountId: alice.accountId });
  });
  it("only allows expected -> received, paid or cancelled, and keeps the sign rule", async () => {
    const income = (await createCashEvent(alice.token, alice.accountId, salary))!;
    await expect(setCashEventStatus(alice.token, alice.eventId, "received")).rejects.toBeInstanceOf(StatusConflictError);
    await expect(setCashEventStatus(alice.token, income.id, "paid")).rejects.toBeInstanceOf(StatusConflictError);
    await expect(setCashEventStatus(alice.token, income.id, "expected")).rejects.toBeInstanceOf(StatusConflictError);
    expect((await setCashEventStatus(alice.token, income.id, "received"))?.status).toBe("received");
    for (const next of ["expected", "received", "paid", "cancelled"]) await expect(setCashEventStatus(alice.token, income.id, next)).rejects.toBeInstanceOf(StatusConflictError);
    expect((await setCashEventStatus(alice.token, alice.eventId, "paid"))?.status).toBe("paid");
    await expect(setCashEventStatus(alice.token, alice.eventId, "cancelled")).rejects.toBeInstanceOf(StatusConflictError);
    await expect(setCashEventStatus(alice.token, alice.eventId, "settled")).rejects.toThrow();
    expect((await eventRow(alice.eventId)).status).toBe("paid");
  });
  it.each([["received", salary], ["paid", rent], ["cancelled", rent]])("refuses to edit or delete a %s event and leaves it unchanged", async (status, input) => {
    const settled = (await createCashEvent(alice.token, alice.accountId, input))!;
    await setCashEventStatus(alice.token, settled.id, status);
    const before = (await fixtures.query("SELECT * FROM cash_events WHERE id = $1", [settled.id])).rows[0];
    await expect(updateCashEvent(alice.token, settled.id, { description: "Changed", amount: "5", expectedDate: "2027-01-01" })).rejects.toBeInstanceOf(StatusConflictError);
    await expect(updateCashEvent(alice.token, settled.id, input)).rejects.toBeInstanceOf(StatusConflictError);
    await expect(deleteCashEvent(alice.token, settled.id)).rejects.toBeInstanceOf(StatusConflictError);
    expect((await fixtures.query("SELECT * FROM cash_events WHERE id = $1", [settled.id])).rows[0]).toEqual(before);
    expect((await listCashEvents(alice.token)).find(e => e.id === settled.id)?.status).toBe(status);
  });
  it("still edits and deletes an expected event", async () => {
    const updated = await updateCashEvent(alice.token, alice.eventId, { description: "Rent", amount: "1200", expectedDate: "2026-10-02" });
    expect(updated).toMatchObject({ amount: "1200.00", status: "expected" });
    expect(await deleteCashEvent(alice.token, alice.eventId)).toBe(true);
  });
  it("deletes an event and reports false the second time", async () => {
    expect(await deleteCashEvent(alice.token, alice.eventId)).toBe(true);
    expect(await deleteCashEvent(alice.token, alice.eventId)).toBe(false);
    expect(await listCashEvents(alice.token)).toEqual([]);
  });
  it("rejects duplicate account names for the caller but allows the same name for another user", async () => {
    await expect(createCashAccount(alice.token, { name: "Main", currency: "USD", openingBalance: "0" })).rejects.toBeInstanceOf(DuplicateAccountNameError);
    const second = (await createCashAccount(alice.token, { name: "Savings", currency: "SGD", openingBalance: "0" }))!;
    await expect(renameCashAccount(alice.token, second.id, "Main")).rejects.toBeInstanceOf(DuplicateAccountNameError);
    expect((await renameCashAccount(alice.token, second.id, " Reserve "))).toMatchObject({ name: "Reserve", currency: "SGD" });
    expect((await listCashAccounts(alice.token)).map(a => a.name)).toEqual(["Main", "Reserve"]);
  });
  it("returns null for account creation and no events when the user has no workspace yet", async () => {
    const carol = await person("carol", false);
    expect(await createCashAccount(carol.token, { name: "Main", currency: "EUR", openingBalance: "0" })).toBeNull();
    expect(await listCashAccounts(carol.token)).toEqual([]);
    expect(await listCashEvents(carol.token)).toEqual([]);
    expect(await saveDangerThreshold(carol.token, "10")).toBe(false);
    expect(await getDangerThreshold(carol.token)).toBeNull();
  });
});

describe("ownership between two users", () => {
  it("lists only the caller's own accounts and events", async () => {
    expect((await listCashAccounts(bob.token)).map(a => a.id)).toEqual([bob.accountId]);
    expect((await listCashEvents(bob.token)).map(e => e.id)).toEqual([bob.eventId]);
  });
  it("gives the same result for another user's id and for a non-existent id, and changes nothing", async () => {
    const before = await eventRow(alice.eventId);
    const attempts = async (accountId: string, eventId: string) => [
      await renameCashAccount(bob.token, accountId, "Hijacked"),
      await createCashEvent(bob.token, accountId, salary),
      await updateCashEvent(bob.token, eventId, { description: "Hijacked", amount: "5", expectedDate: "2026-12-01" }),
      await setCashEventStatus(bob.token, eventId, "cancelled"),
      await deleteCashEvent(bob.token, eventId),
    ];
    const foreign = await attempts(alice.accountId, alice.eventId);
    const missing = await attempts(randomUUID(), randomUUID());
    expect(foreign).toEqual([null, null, null, null, false]);
    expect(foreign).toEqual(missing);
    expect(await eventRow(alice.eventId)).toEqual(before);
    expect((await listCashAccounts(alice.token)).map(a => a.name)).toEqual(["Main"]);
    expect(await count("cash_events", "workspace_id", alice.workspaceId)).toBe(1);
    expect(await count("cash_events", "workspace_id", bob.workspaceId)).toBe(1);
  });
  it("gives another user's settled event the same null as a missing one, not a status conflict", async () => {
    await setCashEventStatus(alice.token, alice.eventId, "paid");
    expect(await updateCashEvent(bob.token, alice.eventId, salary)).toBeNull();
    expect(await deleteCashEvent(bob.token, alice.eventId)).toBe(false);
    expect(await setCashEventStatus(bob.token, alice.eventId, "cancelled")).toBeNull();
    expect((await eventRow(alice.eventId)).status).toBe("paid");
  });
  it("ignores forged owner, workspace and account ids in the input", async () => {
    const created = (await createCashEvent(bob.token, bob.accountId, { ...salary, workspaceId: alice.workspaceId, accountId: alice.accountId, userId: alice.id }))!;
    expect(created.accountId).toBe(bob.accountId);
    expect((await fixtures.query("SELECT workspace_id FROM cash_events WHERE id = $1", [created.id])).rows[0].workspace_id).toBe(bob.workspaceId);
    const account = (await createCashAccount(bob.token, { name: "Forged", currency: "USD", openingBalance: "1", workspaceId: alice.workspaceId }))!;
    expect((await fixtures.query("SELECT workspace_id FROM cash_accounts WHERE id = $1", [account.id])).rows[0].workspace_id).toBe(bob.workspaceId);
  });
  it.each(["not-a-uuid", "", "' OR '1'='1", "3b241101-e2bb-4255-8caf-4136c566a96", "3b241101-e2bb-4255-8caf-4136c566a96g"])("treats the malformed id %j like a missing one, without a database error", async id => {
    expect(await renameCashAccount(bob.token, id, "x")).toBeNull();
    expect(await createCashEvent(bob.token, id, salary)).toBeNull();
    expect(await updateCashEvent(bob.token, id, salary)).toBeNull();
    expect(await setCashEventStatus(bob.token, id, "cancelled")).toBeNull();
    expect(await deleteCashEvent(bob.token, id)).toBe(false);
  });
  it.each([undefined, "", "bad", "0".repeat(64)])("treats the session %j as signed out", async token => {
    expect(await listCashAccounts(token)).toEqual([]);
    expect(await listCashEvents(token)).toEqual([]);
    const denied = "Authentication required.";
    await expect(createCashAccount(token, { name: "X", currency: "EUR", openingBalance: "0" })).rejects.toThrow(denied);
    await expect(renameCashAccount(token, alice.accountId, "X")).rejects.toThrow(denied);
    await expect(createCashEvent(token, alice.accountId, salary)).rejects.toThrow(denied);
    await expect(updateCashEvent(token, alice.eventId, salary)).rejects.toThrow(denied);
    await expect(setCashEventStatus(token, alice.eventId, "cancelled")).rejects.toThrow(denied);
    await expect(deleteCashEvent(token, alice.eventId)).rejects.toThrow(denied);
    await expect(deleteCashEvent(token, "not-a-uuid")).rejects.toThrow(denied);
    expect((await eventRow(alice.eventId)).status).toBe("expected");
  });
  it("treats an expired session as signed out for reads and writes", async () => {
    await fixtures.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [alice.id]);
    expect(await listCashAccounts(alice.token)).toEqual([]);
    expect(await listCashEvents(alice.token)).toEqual([]);
    await expect(updateCashEvent(alice.token, alice.eventId, salary)).rejects.toThrow("Authentication required.");
    await expect(setCashEventStatus(alice.token, alice.eventId, "paid")).rejects.toThrow("Authentication required.");
    await expect(deleteCashEvent(alice.token, alice.eventId)).rejects.toThrow("Authentication required.");
    await expect(createCashEvent(alice.token, alice.accountId, salary)).rejects.toThrow("Authentication required.");
    expect(await eventRow(alice.eventId)).toMatchObject({ description: "Rent", status: "expected" });
  });
});

describe("danger threshold", () => {
  it("starts empty, can be set, replaced, cleared, and belongs to the caller only", async () => {
    expect(await getDangerThreshold(alice.token)).toEqual({ dangerThreshold: null });
    expect(await saveDangerThreshold(alice.token, "1500.5")).toBe(true);
    expect(await getDangerThreshold(alice.token)).toEqual({ dangerThreshold: "1500.50" });
    expect(await getDangerThreshold(bob.token)).toEqual({ dangerThreshold: null });
    expect(await saveDangerThreshold(bob.token, "-20")).toBe(true);
    expect(await getDangerThreshold(alice.token)).toEqual({ dangerThreshold: "1500.50" });
    expect(await saveDangerThreshold(alice.token, "0")).toBe(true);
    expect(await getDangerThreshold(alice.token)).toEqual({ dangerThreshold: "0.00" });
    expect(await saveDangerThreshold(alice.token, null)).toBe(true);
    expect(await getDangerThreshold(alice.token)).toEqual({ dangerThreshold: null });
  });
  it("rejects NaN, extra decimals, exponents and non-strings, leaving the stored value alone", async () => {
    await saveDangerThreshold(alice.token, "100");
    for (const input of ["NaN", "Infinity", "1.234", "1e3", "", " 5", 5, undefined]) await expect(saveDangerThreshold(alice.token, input)).rejects.toThrow();
    expect(await getDangerThreshold(alice.token)).toEqual({ dangerThreshold: "100.00" });
  });
  it("is signed out for anonymous, unknown and expired sessions", async () => {
    for (const token of [undefined, "bad", "0".repeat(64)]) {
      expect(await getDangerThreshold(token)).toBeNull();
      await expect(saveDangerThreshold(token, "5")).rejects.toThrow("Authentication required.");
    }
    await fixtures.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [alice.id]);
    expect(await getDangerThreshold(alice.token)).toBeNull();
    await expect(saveDangerThreshold(alice.token, "5")).rejects.toThrow("Authentication required.");
  });
});

describe("cascade", () => {
  it("deleting the user removes the workspace, its accounts and its events, and nothing of the other user", async () => {
    await createCashAccount(alice.token, { name: "Second", currency: "USD", openingBalance: "0" });
    await createCashEvent(alice.token, alice.accountId, salary);
    expect(await count("cash_accounts", "workspace_id", alice.workspaceId)).toBe(2);
    await fixtures.query("DELETE FROM users WHERE id = $1", [alice.id]);
    expect(await count("workspaces", "id", alice.workspaceId)).toBe(0);
    expect(await count("cash_accounts", "workspace_id", alice.workspaceId)).toBe(0);
    expect(await count("cash_events", "workspace_id", alice.workspaceId)).toBe(0);
    expect(await count("cash_events", "workspace_id", bob.workspaceId)).toBe(1);
  });
  it("does not delete an account that still has events", async () => {
    await expect(fixtures.query("DELETE FROM cash_accounts WHERE id = $1", [alice.accountId])).rejects.toMatchObject({ code: "23503" });
  });
});
