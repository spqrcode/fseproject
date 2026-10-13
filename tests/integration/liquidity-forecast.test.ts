import { beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { saveDangerThreshold, saveWorkspace } from "@/lib/workspace-store";
import { createCashAccount } from "@/lib/cash-events-store";
import { getLiquidityForecast } from "@/lib/liquidity-forecast";
import type { EcbProvider } from "@/lib/fx/ecb-provider";

// A provider double: these tests never reach the network. It reports an outage, so a rate can only come from a
// snapshot the test seeded itself.
const offline: EcbProvider = { fetchRates: async () => ({ ok: false, reason: "offline in tests", fetchedAt: new Date() }) };

// The Liquidity overview's data path end to end: the session-checked store, the pure adapter and the engine,
// against real PostgreSQL. Same connection rules as forecast-input.test.ts.
const testDatabase = (value: string | undefined) => !!value && new URL(value).pathname.endsWith("_test");
const fixturesUrl = process.env.TEST_FIXTURES_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!testDatabase(process.env.DATABASE_URL) || !testDatabase(fixturesUrl) || (!process.env.TEST_FIXTURES_DATABASE_URL && process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}
const fixtures = new Pool({ connectionString: fixturesUrl, max: 2 });

type Person = { token: string; accountId: string; workspaceId: string };
const emails: string[] = [];
let alice: Person, bob: Person;
const window = { startDate: "2026-10-01", endDate: "2026-10-10" };

async function person(name: string): Promise<Person> {
  const email = `liquidity-${name}-${randomUUID()}@example.com`;
  emails.push(email);
  const id = (await fixtures.query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email])).rows[0].id as string;
  const { token } = await createSession(id);
  await saveWorkspace(token, `${name} workspace`);
  const workspaceId = (await fixtures.query("SELECT id FROM workspaces WHERE user_id = $1", [id])).rows[0].id as string;
  const accountId = (await createCashAccount(token, { name: "Operating", currency: "EUR", openingBalance: "1000.00" }))!.id;
  return { token, accountId, workspaceId };
}
async function insert(p: Person, amount: string, status: string, date: string, description = "event") {
  await fixtures.query(`INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date, status)
    VALUES ($1,$2,$3,$4,$5,$6)`, [p.workspaceId, p.accountId, description, amount, date, status]);
}

beforeEach(async () => { alice = await person("alice"); bob = await person("bob"); });
afterEach(async () => {
  await fixtures.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
});
afterAll(async () => { await fixtures.end(); await database().end(); });

describe("liquidity forecast", () => {
  it("projects the stored balance and expected events day by day, with the default threshold", async () => {
    await insert(alice, "200.00", "received", "2026-09-20");                 // already in the starting balance
    await insert(alice, "-300.00", "expected", "2026-09-25", "Late supplier"); // overdue: counted on the start date
    await insert(alice, "-500.00", "expected", "2026-10-04", "Rent");
    await insert(alice, "250.00", "expected", "2026-10-08", "Invoice 42");
    await insert(alice, "-999.00", "cancelled", "2026-10-05");               // never counted
    await insert(alice, "-1.00", "expected", "2026-10-11");                  // after the window

    const forecast = (await getLiquidityForecast(alice.token, { accountId: alice.accountId, ...window }, "EUR", offline))!;
    expect(forecast.account).toEqual({ id: alice.accountId, name: "Operating", currency: "EUR" });
    expect(forecast.startingBalance).toBe("1200.00");
    expect(forecast.eventCount).toBe(3);
    expect(forecast.overdue.map(event => [event.description, event.originalDate, event.expectedDate])).toEqual([["Late supplier", "2026-09-25", "2026-10-01"]]);

    expect(forecast.conversion).toEqual({ status: "NONE", from: "EUR", to: "EUR" });
    const result = forecast.result!;
    expect(result.timeline).toHaveLength(10);
    expect(result.timeline.slice(0, 4).map(point => point.balance)).toEqual(["900", "900", "900", "400"]);
    expect(result).toMatchObject({
      openingBalance: "1200", closingBalance: "650", minimumBalance: "400", minimumDate: "2026-10-04",
      dangerThresholdPercent: "50", dangerThresholdAmount: "600", firstDangerDate: "2026-10-04", runwayDays: 3, currency: "EUR",
    });
  });

  it("uses the workspace's danger threshold when one is set", async () => {
    await saveDangerThreshold(alice.token, "100.00");
    await insert(alice, "-500.00", "expected", "2026-10-04");
    const { result } = (await getLiquidityForecast(alice.token, { accountId: alice.accountId, ...window }, "EUR", offline))!;
    expect(result!).toMatchObject({ dangerThresholdPercent: null, dangerThresholdAmount: "100", firstDangerDate: null, runwayDays: null });
  });

  it("gives null for another user's account, an unknown id or a malformed id, like a missing one", async () => {
    await insert(bob, "-5.00", "expected", "2026-10-02");
    for (const accountId of [bob.accountId, randomUUID(), "not-a-uuid", undefined]) {
      expect(await getLiquidityForecast(alice.token, { accountId, ...window }, "EUR", offline), String(accountId)).toBeNull();
    }
  });

  it("requires a valid session", async () => {
    await expect(getLiquidityForecast(undefined, { accountId: alice.accountId, ...window }, "EUR", offline)).rejects.toThrow("Authentication required.");
    await expect(getLiquidityForecast("a".repeat(64), { accountId: alice.accountId, ...window }, "EUR", offline)).rejects.toThrow("Authentication required.");
  });

  it("shows a dollar account in the reporting currency, with the overdue amounts converted too", async () => {
    await fixtures.query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
    await fixtures.query(`INSERT INTO fx_snapshots (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
      VALUES ('ecb', 'EUR', 'USD', 1.25, '2026-09-30', now())`);
    try {
      const usd = (await createCashAccount(alice.token, { name: "Dollar", currency: "USD", openingBalance: "1000.00" }))!.id;
      await fixtures.query(`INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date, status)
        VALUES ($1, $2, 'Late customer', 250, '2026-09-20', 'expected')`, [alice.workspaceId, usd]);
      const forecast = (await getLiquidityForecast(alice.token, { accountId: usd, ...window }, "EUR", offline))!;
      expect(forecast.conversion).toMatchObject({ status: "CURRENT", from: "USD", to: "EUR", factor: "0.8", effectiveDate: "2026-09-30" });
      expect(forecast.result).toMatchObject({ currency: "EUR", openingBalance: "800", closingBalance: "1000" });
      expect(forecast.overdue.map(event => [event.description, event.amount])).toEqual([["Late customer", "200"]]);
      // The stored balance is still reported as it is stored, in the account's currency.
      expect(forecast.startingBalance).toBe("1000.00");
    } finally {
      await fixtures.query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
    }
  });

  it("shows no figures when no exchange rate is available, instead of the wrong currency", async () => {
    await fixtures.query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
    const usd = (await createCashAccount(alice.token, { name: "Dollar", currency: "USD", openingBalance: "1000.00" }))!.id;
    const forecast = (await getLiquidityForecast(alice.token, { accountId: usd, ...window }, "EUR", offline))!;
    expect(forecast.result).toBeNull();
    expect(forecast.conversion).toMatchObject({ status: "UNAVAILABLE", from: "USD", to: "EUR" });
  });
});
