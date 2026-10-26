import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { saveWorkspace } from "@/lib/workspace-store";
import { createCashAccount, createCashEvent, listCashAccounts, listCashEvents } from "@/lib/cash-events-store";
import { addCashAccount, addCashEvent, changeCashEventStatus, editCashEvent, removeCashEvent } from "@/app/actions/cash-events";
import { SESSION_COOKIE } from "@/lib/auth";

// The Cash events page's server actions end to end against real PostgreSQL. Same request adapters as
// preferences.test.ts and ownership.test.ts: only Next.js cookies, headers, redirect and cache are mocked.
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

type Person = { id: string; token: string; accountId: string };
const emails: string[] = [];
let alice: Person, bob: Person;
const UNAVAILABLE = "redirect:/cash-events?error=event-unavailable";

async function person(name: string): Promise<Person> {
  const email = `actions-${name}-${randomUUID()}@example.com`;
  emails.push(email);
  const id = (await database().query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email])).rows[0].id as string;
  const { token } = await createSession(id);
  await saveWorkspace(token, `${name} workspace`);
  const account = await createCashAccount(token, { name: "Main", currency: "EUR", openingBalance: "100.00" });
  return { id, token, accountId: account!.id };
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
async function event(owner: Person, amount: string, date: string, description = "Event") {
  return (await createCashEvent(owner.token, owner.accountId, { description, amount, expectedDate: date }))!;
}
async function stored(id: string) {
  return (await database().query<{ status: string; expected_date: string; description: string }>(
    "SELECT status, to_char(expected_date, 'YYYY-MM-DD') AS expected_date, description FROM cash_events WHERE id = $1", [id])).rows[0];
}
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const empty = new FormData();
async function redirected(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return (error as Error).message; }
  return "no redirect";
}

beforeAll(async () => { await database().query("SELECT 1"); });
beforeEach(async () => {
  request.origin = "http://localhost:3100";
  request.cookies.clear();
  alice = await person("alice");
  bob = await person("bob");
  request.cookies.set(SESSION_COOKIE, alice.token);
});
afterEach(async () => {
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
});
afterAll(async () => { await database().end(); });

describe("adding and editing", () => {
  it("adds an account and an event for the signed-in user only, ignoring a submitted workspace or user id", async () => {
    await expect(addCashAccount({}, form({ name: "Savings", currency: "USD", openingBalance: "5.50", userId: bob.id, workspaceId: randomUUID() })))
      .rejects.toThrow("redirect:/cash-events?success=account-added");
    expect((await listCashAccounts(alice.token)).map(item => item.name).sort()).toEqual(["Main", "Savings"]);
    expect(await listCashAccounts(bob.token)).toHaveLength(1);

    await expect(addCashEvent({}, form({ accountId: alice.accountId, description: "Rent", amount: "-40", expectedDate: day(5) })))
      .rejects.toThrow("redirect:/cash-events?success=event-added");
    expect(await listCashEvents(alice.token)).toHaveLength(1);
    expect(await listCashEvents(bob.token)).toHaveLength(0);
  });
  it("refuses another user's account without saving anything", async () => {
    const result = await addCashEvent({}, form({ accountId: bob.accountId, description: "Rent", amount: "-40", expectedDate: day(5) }));
    expect(result.error).toBe("That cash account is unavailable.");
    expect(await listCashEvents(bob.token)).toHaveLength(0);
  });
  it("shows validation messages and saves nothing", async () => {
    expect((await addCashEvent({}, form({ accountId: alice.accountId, description: "Rent", amount: "0", expectedDate: day(5) }))).error).toBe("The amount cannot be zero.");
    expect((await addCashEvent({}, form({ accountId: "not-a-uuid", description: "Rent", amount: "-1", expectedDate: day(5) }))).error).toBe("Choose a valid cash account.");
    expect(await listCashEvents(alice.token)).toHaveLength(0);
  });
  it("adds a monthly repeat with a number of occurrences as one event each and says so", async () => {
    await expect(addCashEvent({}, form({ accountId: alice.accountId, description: "Office rent", amount: "-2600", expectedDate: "2027-01-31",
      repeatFrequency: "monthly", repeatEnd: "count", repeatCount: "3" }))).rejects.toThrow("redirect:/cash-events?success=events-added");
    expect((await listCashEvents(alice.token)).map(item => item.expectedDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
  it("adds a quarterly repeat up to an end date, including the end date", async () => {
    await expect(addCashEvent({}, form({ accountId: alice.accountId, description: "VAT", amount: "-900", expectedDate: "2027-01-10",
      repeatFrequency: "quarterly", repeatEnd: "date", repeatUntil: "2027-10-10" }))).rejects.toThrow("redirect:/cash-events?success=events-added");
    expect((await listCashEvents(alice.token)).map(item => item.expectedDate)).toEqual(["2027-01-10", "2027-04-10", "2027-07-10", "2027-10-10"]);
  });
  it("treats 'once' as a single event and ignores end fields", async () => {
    await expect(addCashEvent({}, form({ accountId: alice.accountId, description: "Once", amount: "-5", expectedDate: day(5), repeatFrequency: "once", repeatEnd: "count", repeatCount: "12" })))
      .rejects.toThrow("redirect:/cash-events?success=event-added");
    expect(await listCashEvents(alice.token)).toHaveLength(1);
  });
  it("refuses an unknown frequency, a missing or invalid end, an end before the start, too many occurrences, a repeat past 2100 and another user's account, saving nothing", async () => {
    const base = { accountId: alice.accountId, description: "X", amount: "-5", expectedDate: "2027-01-15" };
    const error = async (values: Record<string, string>) => (await addCashEvent({}, form({ ...base, ...values }))).error;
    expect(await error({ repeatFrequency: "weekly" })).toBe("Choose how often the event repeats.");
    expect(await error({ repeatFrequency: "monthly" })).toBe("Choose when the repeat ends.");
    expect(await error({ repeatFrequency: "monthly", repeatEnd: "count", repeatCount: "61" })).toBe("Enter how many times it occurs, from 2 to 60.");
    expect(await error({ repeatFrequency: "monthly", repeatEnd: "date", repeatUntil: "2026-12-31" })).toBe("The end date must not be before the first date.");
    expect(await error({ repeatFrequency: "monthly", repeatEnd: "date", repeatUntil: "2035-01-15" })).toBe("A repeating event can have at most 60 occurrences. Choose an earlier end date.");
    expect(await error({ expectedDate: "2100-11-15", repeatFrequency: "monthly", repeatEnd: "count", repeatCount: "3" })).toBe("The last occurrence must be on or before 31 December 2100.");
    expect(await error({ accountId: bob.accountId, repeatFrequency: "annually", repeatEnd: "count", repeatCount: "5" })).toBe("That cash account is unavailable.");
    expect(await listCashEvents(alice.token)).toHaveLength(0);
    expect(await listCashEvents(bob.token)).toHaveLength(0);
  });
  it("edits an expected event, and says so when it was settled meanwhile", async () => {
    const created = await event(alice, "-10", day(5), "Old name");
    await expect(editCashEvent(created.id, {}, form({ description: "New name", amount: "-12", expectedDate: day(6) })))
      .rejects.toThrow("redirect:/cash-events?success=event-updated");
    expect((await stored(created.id)).description).toBe("New name");

    await database().query("UPDATE cash_events SET status = 'paid' WHERE id = $1", [created.id]);
    const result = await editCashEvent(created.id, {}, form({ description: "Too late", amount: "-12", expectedDate: day(6) }));
    expect(result.error).toBe("Only expected events can be edited.");
    expect((await stored(created.id)).description).toBe("New name");
  });
  it("does not edit another user's event", async () => {
    const theirs = await event(bob, "-10", day(5), "Theirs");
    const result = await editCashEvent(theirs.id, {}, form({ description: "Mine now", amount: "-1", expectedDate: day(6) }));
    expect(result.error).toBe("That cash event is unavailable.");
    expect((await stored(theirs.id)).description).toBe("Theirs");
  });
});

describe("settling, cancelling and deleting", () => {
  it("marks a past or today's event paid without moving its date, and says nothing about a move", async () => {
    const created = await event(alice, "-10", day(-3));
    expect(await redirected(changeCashEventStatus(created.id, "paid", empty))).toBe("redirect:/cash-events?success=event-paid");
    expect(await stored(created.id)).toMatchObject({ status: "paid", expected_date: day(-3) });
  });
  it("moves a future event to today when it is settled and the message says so", async () => {
    const created = await event(alice, "250", day(9));
    expect(await redirected(changeCashEventStatus(created.id, "received", empty))).toBe("redirect:/cash-events?success=event-received-today");
    expect(await stored(created.id)).toMatchObject({ status: "received", expected_date: day(0) });
  });
  it("keeps the planned date when a future event is cancelled", async () => {
    const created = await event(alice, "250", day(9));
    expect(await redirected(changeCashEventStatus(created.id, "cancelled", empty))).toBe("redirect:/cash-events?success=event-cancelled");
    expect(await stored(created.id)).toMatchObject({ status: "cancelled", expected_date: day(9) });
  });
  it("answers a forged or impossible change with 'nothing was changed', not an error page", async () => {
    const income = await event(alice, "250", day(9));
    const expense = await event(alice, "-10", day(9));
    // The client can change the bound status: an income cannot be paid and an expense cannot be received.
    expect(await redirected(changeCashEventStatus(income.id, "paid", empty))).toBe(UNAVAILABLE);
    expect(await redirected(changeCashEventStatus(expense.id, "received", empty))).toBe(UNAVAILABLE);
    expect(await redirected(changeCashEventStatus(income.id, "expected", empty))).toBe(UNAVAILABLE);
    expect(await redirected(changeCashEventStatus(income.id, "bogus", empty))).toBe(UNAVAILABLE);
    expect(await redirected(changeCashEventStatus("not-a-uuid", "paid", empty))).toBe(UNAVAILABLE);
    expect(await stored(income.id)).toMatchObject({ status: "expected", expected_date: day(9) });
    expect(await stored(expense.id)).toMatchObject({ status: "expected", expected_date: day(9) });
  });
  it("answers an action on an already settled event with 'nothing was changed' and leaves it alone", async () => {
    const created = await event(alice, "-10", day(2));
    await database().query("UPDATE cash_events SET status = 'paid' WHERE id = $1", [created.id]);
    expect(await redirected(changeCashEventStatus(created.id, "cancelled", empty))).toBe(UNAVAILABLE);
    expect(await redirected(removeCashEvent(created.id, empty))).toBe(UNAVAILABLE);
    expect(await stored(created.id)).toMatchObject({ status: "paid" });
  });
  it("deletes an expected event", async () => {
    const created = await event(alice, "-10", day(2));
    expect(await redirected(removeCashEvent(created.id, empty))).toBe("redirect:/cash-events?success=event-deleted");
    expect(await stored(created.id)).toBeUndefined();
  });
  it("leaves another user's event unchanged and reports it as unavailable", async () => {
    const theirs = await event(bob, "-10", day(9), "Theirs");
    expect(await redirected(changeCashEventStatus(theirs.id, "paid", empty))).toBe(UNAVAILABLE);
    expect(await redirected(removeCashEvent(theirs.id, empty))).toBe(UNAVAILABLE);
    expect(await stored(theirs.id)).toMatchObject({ status: "expected", expected_date: day(9), description: "Theirs" });
  });
});

describe("request and session checks on every action", () => {
  it.each([null, "https://untrusted.example"])("saves nothing when the origin is missing or foreign: %s", async origin => {
    const created = await event(alice, "-10", day(9));
    request.origin = origin;
    expect((await addCashAccount({}, form({ name: "Evil", currency: "EUR", openingBalance: "1" }))).error).toBe("Unable to add the cash account. Please try again.");
    expect((await addCashEvent({}, form({ accountId: alice.accountId, description: "Evil", amount: "-1", expectedDate: day(3) }))).error).toBe("Unable to add the cash event. Please try again.");
    expect((await editCashEvent(created.id, {}, form({ description: "Evil", amount: "-1", expectedDate: day(3) }))).error).toBe("Unable to update the cash event. Please try again.");
    await expect(changeCashEventStatus(created.id, "paid", empty)).rejects.toThrow();
    await expect(removeCashEvent(created.id, empty)).rejects.toThrow();
    expect(await stored(created.id)).toMatchObject({ status: "expected", description: "Event", expected_date: day(9) });
    expect(await listCashAccounts(alice.token)).toHaveLength(1);
    expect(await listCashEvents(alice.token)).toHaveLength(1);
  });
  it("sends anonymous and expired sessions to sign in without touching data", async () => {
    const created = await event(alice, "-10", day(9));
    // Thunks, so that each action starts only when it is awaited and no rejection is left unhandled.
    const attempts = [
      () => addCashAccount({}, form({ name: "X", currency: "EUR", openingBalance: "1" })),
      () => addCashEvent({}, form({ accountId: alice.accountId, description: "X", amount: "-1", expectedDate: day(3) })),
      () => editCashEvent(created.id, {}, form({ description: "X", amount: "-1", expectedDate: day(3) })),
      () => changeCashEventStatus(created.id, "paid", empty),
      () => removeCashEvent(created.id, empty),
    ];
    request.cookies.clear();
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow("redirect:/login");
    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [alice.id]);
    request.cookies.set(SESSION_COOKIE, alice.token);
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow("redirect:/login");
    expect(await stored(created.id)).toMatchObject({ status: "expected", description: "Event" });
    const count = await database().query("SELECT count(*)::int AS n FROM cash_accounts WHERE workspace_id IN (SELECT id FROM workspaces WHERE user_id = $1)", [alice.id]);
    expect(count.rows[0].n).toBe(1);
  });
});
