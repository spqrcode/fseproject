import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { saveWorkspace, saveDangerThreshold } from "@/lib/workspace-store";
import { createCashAccount, createCashEvent, setCashEventStatus } from "@/lib/cash-events-store";
import { addDelayAdjustment, createScenario } from "@/lib/scenario-store";
import { getScenarioComparison } from "@/lib/scenario-comparison";
import type { EcbProvider } from "@/lib/fx/ecb-provider";

// A provider double: no test reaches the network. It reports an outage, so a rate can only come from a snapshot a
// test seeded itself.
const offline: EcbProvider = { fetchRates: async () => ({ ok: false, reason: "offline in tests", fetchedAt: new Date() }) };

// The Scenario Lab's comparison end to end against real PostgreSQL: session-checked stores, the forecast input, the
// adapter, the engine and the scenario calculation. Same connection rules as the other integration files.
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

type Person = { id: string; token: string; accountId: string };
const emails: string[] = [];
let alice: Person, bob: Person;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const window = () => ({ startDate: day(0), endDate: day(89) });

async function person(name: string): Promise<Person> {
  const email = `comparison-${name}-${randomUUID()}@example.com`;
  emails.push(email);
  const id = (await database().query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email])).rows[0].id as string;
  const { token } = await createSession(id);
  await saveWorkspace(token, `${name} workspace`);
  const account = await createCashAccount(token, { name: "Main", currency: "EUR", openingBalance: "1000.00" });
  return { id, token, accountId: account!.id };
}
const income = (p: Person, amount: string, date: string, description = "Invoice", accountId = p.accountId) =>
  createCashEvent(p.token, accountId, { description, amount, expectedDate: date }).then(item => item!);

beforeEach(async () => { alice = await person("alice"); bob = await person("bob"); });
afterEach(async () => {
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
});
afterAll(async () => { await database().end(); });

describe("base versus scenario for one account", () => {
  it("shows the delay's effect on the balance in between and on the lowest point, and the contributions add up", async () => {
    await income(alice, "-700.00", day(10), "Rent");
    const invoice = await income(alice, "600.00", day(5), "Customer invoice");
    const leaves = await income(alice, "250.00", day(40), "Second invoice");
    const scenario = await createScenario(alice.token, "Late payers");
    await addDelayAdjustment(alice.token, scenario.id, invoice.id, day(20));
    await addDelayAdjustment(alice.token, scenario.id, leaves.id, day(120));   // beyond the 90 days

    const result = (await getScenarioComparison(alice.token, { scenarioId: scenario.id, accountId: alice.accountId, ...window() }, "EUR", offline))!;
    const { base, scenario: shocked, closingDelta, contributions, contributionsTotal } = result.comparison!;

    expect(result.account).toMatchObject({ name: "Main", currency: "EUR" });
    expect(base.openingBalance).toBe("1000");
    // Base: 1000 + 600 on day 5, -700 on day 10 -> lowest 900. Scenario: the invoice arrives after the rent -> 300.
    expect(base.minimumBalance).toBe("900");
    expect(shocked.minimumBalance).toBe("300");
    expect(result.comparison!.minimumDelta).toBe("-600");
    expect(shocked.firstDangerDate).toBe(day(10));       // 300 is below the 50% threshold of 500
    expect(base.firstDangerDate).toBeNull();
    // Closing: the first invoice still arrives inside the range, the second one leaves it.
    expect(closingDelta).toBe("-250");
    expect(contributions.map(item => item.closingDelta)).toEqual(["0", "-250"]);
    expect(contributionsTotal).toBe(closingDelta);
    expect(result.comparison!.skipped).toEqual([]);
  });

  it("does not change the stored events or the base forecast", async () => {
    const invoice = await income(alice, "600.00", day(5));
    const scenario = await createScenario(alice.token, "Check isolation");
    await addDelayAdjustment(alice.token, scenario.id, invoice.id, day(30));
    const before = await database().query("SELECT expected_date::text AS d, amount::text AS a, status FROM cash_events WHERE id = $1", [invoice.id]);
    const first = (await getScenarioComparison(alice.token, { scenarioId: scenario.id, accountId: alice.accountId, ...window() }, "EUR", offline))!;
    const after = await database().query("SELECT expected_date::text AS d, amount::text AS a, status FROM cash_events WHERE id = $1", [invoice.id]);
    expect(after.rows).toEqual(before.rows);
    // Running it again gives the same numbers: nothing was written and nothing is cached in between.
    const second = (await getScenarioComparison(alice.token, { scenarioId: scenario.id, accountId: alice.accountId, ...window() }, "EUR", offline))!;
    expect(second.comparison!.base).toEqual(first.comparison!.base);
    expect(second.comparison!.scenario).toEqual(first.comparison!.scenario);
  });

  it("uses the workspace's danger threshold when one is set", async () => {
    await saveDangerThreshold(alice.token, "950.00");
    const invoice = await income(alice, "600.00", day(5));
    await income(alice, "-700.00", day(10), "Rent");
    const scenario = await createScenario(alice.token, "Threshold");
    await addDelayAdjustment(alice.token, scenario.id, invoice.id, day(20));
    const result = (await getScenarioComparison(alice.token, { scenarioId: scenario.id, accountId: alice.accountId, ...window() }, "EUR", offline))!;
    expect(result.comparison!.base.dangerThresholdAmount).toBe("950");
    expect(result.comparison!.scenario.firstDangerDate).toBe(day(10));
  });

  it("skips an adjustment whose invoice was received since, and one on another account, and reports both", async () => {
    const received = await income(alice, "300.00", day(3), "Will be received");
    const other = await createCashAccount(alice.token, { name: "Second", currency: "EUR", openingBalance: "0.00" });
    const onOther = await income(alice, "400.00", day(4), "On the second account", other!.id);
    const applies = await income(alice, "500.00", day(5), "Applies");
    const scenario = await createScenario(alice.token, "Mixed");
    await addDelayAdjustment(alice.token, scenario.id, received.id, day(30));
    await addDelayAdjustment(alice.token, scenario.id, onOther.id, day(30));
    await addDelayAdjustment(alice.token, scenario.id, applies.id, day(120));
    await setCashEventStatus(alice.token, received.id, "received");

    const result = (await getScenarioComparison(alice.token, { scenarioId: scenario.id, accountId: alice.accountId, ...window() }, "EUR", offline))!;
    expect(result.comparison!.skipped.map(item => item.reason).sort()).toEqual(["not_applicable", "not_in_forecast"]);
    expect(result.comparison!.contributions).toHaveLength(1);
    expect(result.comparison!.closingDelta).toBe("-500");
    expect(result.comparison!.contributionsTotal).toBe("-500");
  });
});

describe("ownership", () => {
  it("gives null for another user's scenario or account, an unknown id and a malformed id", async () => {
    const mine = await createScenario(alice.token, "Mine");
    const theirs = await createScenario(bob.token, "Theirs");
    const w = window();
    expect(await getScenarioComparison(alice.token, { scenarioId: theirs.id, accountId: alice.accountId, ...w }, "EUR", offline)).toBeNull();
    expect(await getScenarioComparison(alice.token, { scenarioId: mine.id, accountId: bob.accountId, ...w }, "EUR", offline)).toBeNull();
    expect(await getScenarioComparison(alice.token, { scenarioId: randomUUID(), accountId: alice.accountId, ...w }, "EUR", offline)).toBeNull();
    expect(await getScenarioComparison(alice.token, { scenarioId: "not-a-uuid", accountId: alice.accountId, ...w }, "EUR", offline)).toBeNull();
    expect(await getScenarioComparison(alice.token, { scenarioId: mine.id, accountId: "not-a-uuid", ...w }, "EUR", offline)).toBeNull();
  });
  it("requires a valid session", async () => {
    const mine = await createScenario(alice.token, "Mine");
    await expect(getScenarioComparison(undefined, { scenarioId: mine.id, accountId: alice.accountId, ...window() }, "EUR", offline)).resolves.toBeNull();
    await expect(getScenarioComparison("a".repeat(64), { scenarioId: mine.id, accountId: alice.accountId, ...window() }, "EUR", offline)).resolves.toBeNull();
  });
});

describe("in the reporting currency", () => {
  it("compares a dollar account in euro with the persisted ECB rate, and the contributions still add up", async () => {
    await database().query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
    // A rate with a non-terminating reciprocal, like the real EUR/SGD 1.4127: converted amounts carry 40 digits.
    await database().query(`INSERT INTO fx_snapshots (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
      VALUES ('ecb', 'EUR', 'USD', 1.4127, $1, now())`, [day(-1)]);
    try {
      const usd = (await createCashAccount(alice.token, { name: "Dollar", currency: "USD", openingBalance: "14127.00" }))!;
      const invoice = await income(alice, "1412.70", day(5), "US invoice", usd.id);
      const leaves = await income(alice, "2825.40", day(20), "Second US invoice", usd.id);
      await income(alice, "-9888.90", day(10), "Payroll", usd.id);
      const scenario = await createScenario(alice.token, "US delays");
      await addDelayAdjustment(alice.token, scenario.id, invoice.id, day(30));
      await addDelayAdjustment(alice.token, scenario.id, leaves.id, day(120));

      const result = (await getScenarioComparison(alice.token, { scenarioId: scenario.id, accountId: usd.id, ...window() }, "EUR", offline))!;
      expect(result.conversion).toMatchObject({ status: "CURRENT", from: "USD", to: "EUR", effectiveDate: day(-1) });
      const comparison = result.comparison!;
      expect(comparison.base.currency).toBe("EUR");
      // 14,127 USD at 1.4127 USD per EUR is 10,000 EUR.
      expect(comparison.base.openingBalance).toBe("10000");
      // The second invoice leaves the 90 days: -2,825.40 USD is -2,000 EUR. The first stays inside: no effect.
      expect(Number(comparison.closingDelta)).toBeCloseTo(-2000, 10);
      expect(comparison.contributions.map(item => Number(item.closingDelta))).toEqual([0, expect.closeTo(-2000, 10)]);
      expect(Math.abs(Number(comparison.contributionsTotal) - Number(comparison.closingDelta))).toBeLessThan(1e-10);
    } finally {
      await database().query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
    }
  });

  it("shows no comparison at all when no exchange rate is available", async () => {
    await database().query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
    const usd = (await createCashAccount(alice.token, { name: "Dollar", currency: "USD", openingBalance: "1000.00" }))!;
    const invoice = await income(alice, "500.00", day(5), "US invoice", usd.id);
    const scenario = await createScenario(alice.token, "US delay");
    await addDelayAdjustment(alice.token, scenario.id, invoice.id, day(30));
    const result = (await getScenarioComparison(alice.token, { scenarioId: scenario.id, accountId: usd.id, ...window() }, "EUR", offline))!;
    expect(result.comparison).toBeNull();
    expect(result.conversion).toMatchObject({ status: "UNAVAILABLE", from: "USD", to: "EUR" });
  });
});
