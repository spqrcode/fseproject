import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { saveWorkspace } from "@/lib/workspace-store";
import { createCashAccount, createCashEvent } from "@/lib/cash-events-store";
import { createScenario, getAdjustments, getScenarios } from "@/lib/scenario-store";
import { getScenarioFxShocks } from "@/lib/fx/shock-store";
import { addInvoiceDelay, addScenario, saveFxShock } from "@/app/actions/scenarios";
import { SESSION_COOKIE } from "@/lib/auth";

// The Scenario lab's server actions end to end against real PostgreSQL. Same request adapters as
// cash-event-actions.test.ts: only Next.js cookies, headers, redirect and cache are mocked.
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

type Person = { id: string; token: string; scenarioId: string; invoiceId: string };
const emails: string[] = [];
let alice: Person, bob: Person;
let snapshotId: string;
const SNAPSHOT_DATE = "2099-02-02";   // far from any real observation, removed after each test

async function person(name: string): Promise<Person> {
  const email = `scenario-actions-${name}-${randomUUID()}@example.com`;
  emails.push(email);
  const id = (await database().query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email])).rows[0].id as string;
  const { token } = await createSession(id);
  await saveWorkspace(token, `${name} workspace`);
  const account = (await createCashAccount(token, { name: "Main", currency: "EUR", openingBalance: "100.00" }))!;
  const invoice = (await createCashEvent(token, account.id, { description: "Invoice", amount: "300.00", expectedDate: "2026-11-02" }))!;
  const scenario = await createScenario(token, `${name} scenario`);
  return { id, token, scenarioId: scenario.id, invoiceId: invoice.id };
}
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
async function redirected(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return (error as Error).message; }
  return "no redirect";
}
const delay = (p: Person, values: Partial<Record<string, string>> = {}) =>
  form({ scenarioId: p.scenarioId, cashEventId: p.invoiceId, dateOverride: "2026-11-30", ...values } as Record<string, string>);
const shock = (p: Person, values: Partial<Record<string, string>> = {}) =>
  form({ scenarioId: p.scenarioId, snapshotId, shockPercent: "-10", ...values } as Record<string, string>);

beforeAll(async () => { await database().query("SELECT 1"); });
beforeEach(async () => {
  request.origin = "http://localhost:3100";
  request.cookies.clear();
  alice = await person("alice");
  bob = await person("bob");
  snapshotId = (await database().query(`INSERT INTO fx_snapshots (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
    VALUES ('ecb', 'EUR', 'USD', 1.0856, $1, now()) RETURNING id`, [SNAPSHOT_DATE])).rows[0].id as string;
  request.cookies.set(SESSION_COOKIE, alice.token);
});
afterEach(async () => {
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
  await database().query("DELETE FROM fx_snapshots WHERE provider = 'ecb' AND effective_date = $1", [SNAPSHOT_DATE]);
});
afterAll(async () => { await database().end(); });

describe("the three actions for the signed-in user", () => {
  it("creates a scenario in the caller's workspace only", async () => {
    const target = await redirected(addScenario({}, form({ name: "Late payer", workspaceId: randomUUID(), userId: bob.id })));
    expect(target).toMatch(/^redirect:\/scenarios\?scenario=[0-9a-f-]{36}&success=scenario-added$/);
    expect((await getScenarios(alice.token)).map(item => item.name).sort()).toEqual(["Late payer", "alice scenario"]);
    expect((await getScenarios(bob.token)).map(item => item.name)).toEqual(["bob scenario"]);
  });
  it("delays the caller's own invoice, and the real event keeps its date", async () => {
    expect(await redirected(addInvoiceDelay({}, delay(alice)))).toBe(`redirect:/scenarios?scenario=${alice.scenarioId}&success=delay-added`);
    expect((await getAdjustments(alice.token, alice.scenarioId)).map(item => item.dateOverride)).toEqual(["2026-11-30"]);
    const stored = await database().query("SELECT to_char(expected_date, 'YYYY-MM-DD') AS d FROM cash_events WHERE id = $1", [alice.invoiceId]);
    expect(stored.rows[0].d).toBe("2026-11-02");
  });
  it("saves a shock on a stored snapshot, and says so when the same snapshot already has one", async () => {
    expect(await redirected(saveFxShock({}, shock(alice)))).toBe(`redirect:/scenarios?scenario=${alice.scenarioId}&success=shock-added`);
    expect((await getScenarioFxShocks(alice.token, alice.scenarioId)).map(item => item.shockPercent)).toEqual(["-10"]);
    expect((await saveFxShock({}, shock(alice, { shockPercent: "-5" }))).error).toBe("This scenario already has a shock for this exchange-rate snapshot.");
    expect(await getScenarioFxShocks(alice.token, alice.scenarioId)).toHaveLength(1);
  });
  it("shows validation messages and saves nothing", async () => {
    expect((await addScenario({}, form({ name: "  " }))).error).toBeTruthy();
    expect((await addInvoiceDelay({}, delay(alice, { dateOverride: "2026-02-30" }))).error).toBeTruthy();
    expect((await addInvoiceDelay({}, delay(alice, { dateOverride: "2026-10-01" }))).error).toBe("Choose an expected income event and a date later than its original date.");
    // The bounds from #24, with the same message for the preview and for saving.
    for (const value of ["-100", "100.0001", "5000", "1.00001"]) {
      expect((await saveFxShock({}, shock(alice, { shockPercent: value }))).error, value)
        .toBe("Shock percentage must be a plain number from -99.99% to 100% with at most 4 decimals.");
    }
    expect((await saveFxShock({}, shock(alice, { snapshotId: "not-a-uuid" }))).error).toBe("Choose a valid scenario, snapshot and percentage.");
    expect(await getAdjustments(alice.token, alice.scenarioId)).toEqual([]);
    expect(await getScenarioFxShocks(alice.token, alice.scenarioId)).toEqual([]);
  });
});

describe("another user's scenario or event", () => {
  it("refuses to delay another user's invoice or to use another user's scenario, and changes nothing", async () => {
    expect((await addInvoiceDelay({}, delay(alice, { cashEventId: bob.invoiceId }))).error).toBeTruthy();
    expect((await addInvoiceDelay({}, delay(alice, { scenarioId: bob.scenarioId }))).error).toBeTruthy();
    expect((await saveFxShock({}, shock(alice, { scenarioId: bob.scenarioId }))).error).toBeTruthy();
    expect(await getAdjustments(alice.token, alice.scenarioId)).toEqual([]);
    expect(await getAdjustments(bob.token, bob.scenarioId)).toEqual([]);
    expect(await getScenarioFxShocks(bob.token, bob.scenarioId)).toEqual([]);
    const stored = await database().query("SELECT to_char(expected_date, 'YYYY-MM-DD') AS d FROM cash_events WHERE id = $1", [bob.invoiceId]);
    expect(stored.rows[0].d).toBe("2026-11-02");
  });
});

describe("request and session checks on every action", () => {
  it.each([null, "https://untrusted.example"])("saves nothing when the origin is missing or foreign: %s", async origin => {
    request.origin = origin;
    expect((await addScenario({}, form({ name: "Evil" }))).error).toBeTruthy();
    expect((await addInvoiceDelay({}, delay(alice))).error).toBeTruthy();
    expect((await saveFxShock({}, shock(alice))).error).toBeTruthy();
    expect((await getScenarios(alice.token)).map(item => item.name)).toEqual(["alice scenario"]);
    expect(await getAdjustments(alice.token, alice.scenarioId)).toEqual([]);
    expect(await getScenarioFxShocks(alice.token, alice.scenarioId)).toEqual([]);
  });
  it("sends anonymous and expired sessions to sign in without touching data", async () => {
    // Thunks, so that each action starts only when it is awaited and no rejection is left unhandled.
    const attempts = [
      () => addScenario({}, form({ name: "X" })),
      () => addInvoiceDelay({}, delay(alice)),
      () => saveFxShock({}, shock(alice)),
    ];
    request.cookies.clear();
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow("redirect:/login");
    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [alice.id]);
    request.cookies.set(SESSION_COOKIE, alice.token);
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow("redirect:/login");
    const counts = await database().query(`SELECT
        (SELECT count(*)::int FROM scenarios sc JOIN workspaces w ON w.id = sc.workspace_id WHERE w.user_id = $1) AS scenarios,
        (SELECT count(*)::int FROM scenario_adjustments WHERE scenario_id = $2) AS adjustments,
        (SELECT count(*)::int FROM scenario_fx_shocks WHERE scenario_id = $2) AS shocks`, [alice.id, alice.scenarioId]);
    expect(counts.rows[0]).toEqual({ scenarios: 1, adjustments: 0, shocks: 0 });
  });
});
