import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { listCashAccounts, listCashEvents } from "@/lib/cash-events-store";
import { getForecastInput } from "@/lib/forecast-input-store";
import { getAdjustments, getScenarios } from "@/lib/scenario-store";
import { runForecast, runScenarioForecast, toForecastInput } from "@/lib/forecast";
import { checkDemo, DEMO_PLAN, isoDay, seedDemo } from "../../scripts/demo-seed.mjs";

// The demo seed against real PostgreSQL: what it writes, that the story it is meant to tell holds when the real
// stores and the engine read it back, and that it refuses to touch a workspace that already has data.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "http://localhost:3100" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test") || process.env.DATABASE_URL !== url) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}

const emails: string[] = [];
let client: Client;
const today = new Date();

async function registered() {
  const email = `demo-seed-${randomUUID()}@example.com`;
  emails.push(email);
  const id = (await database().query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email])).rows[0].id as string;
  return { email, id, token: (await createSession(id)).token };
}

beforeEach(async () => {
  client = new Client({ connectionString: url });
  await client.connect();
});
afterEach(async () => {
  await client.end();
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
});
afterAll(async () => { await database().end(); });

describe("demo seed", () => {
  it("creates the workspace, accounts, events and scenarios for a registered user, dated from today", async () => {
    const user = await registered();
    const result = await seedDemo(client, { email: user.email.toUpperCase(), today });
    expect(result).toMatchObject({ accounts: 3, events: 16, scenarios: 2 });

    const accounts = await listCashAccounts(user.token);
    const byName = (rows: string[][]) => [...rows].sort((a, b) => a[0].localeCompare(b[0]));
    expect(byName(accounts.map(account => [account.name, account.currency, account.openingBalance]))).toEqual(
      byName(DEMO_PLAN.accounts.map(account => [account.name, account.currency, account.openingBalance])));
    const events = await listCashEvents(user.token);
    expect(events).toHaveLength(16);
    expect(events.every(event => event.status === "expected")).toBe(true);
    const invoice = events.find(event => event.description === "Customer invoice 2026-118")!;
    expect(invoice.expectedDate).toBe(isoDay(today, 8));

    const scenarios = await getScenarios(user.token);
    // Both scenarios are inserted in one transaction, so they share created_at and their order is not defined.
    expect(scenarios.map(scenario => scenario.name).sort()).toEqual(DEMO_PLAN.scenarios.map(scenario => scenario.name).sort());
    for (const scenario of scenarios) {
      const adjustments = await getAdjustments(user.token, scenario.id);
      expect(adjustments.map(item => item.status)).toEqual(["active"]);
    }
  });

  it("tells the intended story: the late invoice takes the euro account below its threshold on payroll day", async () => {
    const user = await registered();
    await seedDemo(client, { email: user.email, today });
    const eur = (await listCashAccounts(user.token)).find(account => account.currency === "EUR")!;
    const stored = (await getForecastInput(user.token, { accountId: eur.id, startDate: isoDay(today, 0), endDate: isoDay(today, 89) }))!;
    const input = toForecastInput(stored);
    const base = runForecast(input);

    expect(base.dangerThresholdAmount).toBe("10000");
    expect(base.firstDangerDate).toBeNull();
    expect(base.minimumBalance).toBe("13500");

    const late = (await getScenarios(user.token)).find(scenario => scenario.name === "Customer invoice three weeks late")!;
    const adjustments = await getAdjustments(user.token, late.id);
    const scenario = runScenarioForecast({
      scenarioId: late.id, adjustments, baseEvents: input.events, baseForecast: base,
      startDate: input.startDate, endDate: input.endDate, currency: input.currency,
    });
    expect(scenario.skipped).toEqual([]);
    expect(scenario.result.firstDangerDate).toBe(isoDay(today, 10));
    // 20,000 - 1,500 overdue - 3,000 rent - 7,000 payroll, with the 9,000 invoice not yet in.
    expect(scenario.result.minimumBalance).toBe("8500");
    // The invoice still arrives inside the 90 days, so only the path changes, not the closing balance.
    expect(scenario.contributionDelta).toBe("0");
  });

  it("refuses a workspace that already has cash accounts and writes nothing", async () => {
    const user = await registered();
    await seedDemo(client, { email: user.email, today });
    await expect(seedDemo(client, { email: user.email, today })).rejects.toThrow("already has cash accounts");
    expect(await listCashAccounts(user.token)).toHaveLength(3);
    expect(await listCashEvents(user.token)).toHaveLength(16);
    expect(await getScenarios(user.token)).toHaveLength(2);
  });

  it("keeps an existing workspace name and refuses an unknown user", async () => {
    const user = await registered();
    await database().query("INSERT INTO workspaces (user_id, name) VALUES ($1, 'My company')", [user.id]);
    await seedDemo(client, { email: user.email, today });
    const name = await database().query("SELECT name FROM workspaces WHERE user_id = $1", [user.id]);
    expect(name.rows[0].name).toBe("My company");

    await expect(seedDemo(client, { email: `nobody-${randomUUID()}@example.com`, today })).rejects.toThrow("Register the demo user");
    await expect(seedDemo(client, { email: "not-an-email", today })).rejects.toThrow("--email");
  });

  it("the read-only check says whether seeding would work, and writes nothing", async () => {
    expect(await checkDemo(client, { email: `nobody-${randomUUID()}@example.com` })).toEqual({ userExists: false, workspaceExists: false, accounts: 0, ready: false });

    const user = await registered();
    expect(await checkDemo(client, { email: user.email })).toEqual({ userExists: true, workspaceExists: false, accounts: 0, ready: true });
    // Read-only: the check created nothing.
    expect((await database().query("SELECT count(*)::int AS n FROM workspaces WHERE user_id = $1", [user.id])).rows[0].n).toBe(0);

    await seedDemo(client, { email: user.email, today });
    expect(await checkDemo(client, { email: user.email.toUpperCase() })).toEqual({ userExists: true, workspaceExists: true, accounts: 3, ready: false });
    // The connection is left usable for the next statement (the read-only transaction was closed).
    expect((await client.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
  });
});
