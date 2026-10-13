import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { saveDangerThreshold, saveWorkspace } from "@/lib/workspace-store";
import { createCashAccount, createCashEvent } from "@/lib/cash-events-store";
import { getForecastInReportingCurrency } from "@/lib/forecast-reporting";
import type { EcbProvider } from "@/lib/fx/ecb-provider";

// A forecast expressed in the reporting currency, end to end against real PostgreSQL: the session-checked input, the
// persisted ECB snapshots through the rate service, the conversion and the engine. The provider is a test double, so
// nothing here touches the network.
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

type Person = { token: string; usdAccountId: string; eurAccountId: string };
const emails: string[] = [];
let alice: Person, bob: Person;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const window = () => ({ startDate: day(0), endDate: day(29) });

function provider(): EcbProvider & { calls: number } {
  const double = {
    calls: 0,
    async fetchRates() {
      double.calls += 1;
      return { ok: false as const, reason: "the test provider is down", fetchedAt: new Date() };
    },
  };
  return double;
}
async function seedRates(fetchedAt: Date, rates = { USD: "1.25", SGD: "1.40" }, effectiveDate = day(-1)) {
  for (const [quote, rate] of Object.entries(rates)) {
    await database().query(
      `INSERT INTO fx_snapshots (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
       VALUES ('ecb', 'EUR', $1, $2, $3, $4)`, [quote, rate, effectiveDate, fetchedAt]);
  }
}
async function person(name: string): Promise<Person> {
  const email = `reporting-${name}-${randomUUID()}@example.com`;
  emails.push(email);
  const id = (await database().query("INSERT INTO users(email, password_hash) VALUES ($1, 'unused') RETURNING id", [email])).rows[0].id as string;
  const { token } = await createSession(id);
  await saveWorkspace(token, `${name} workspace`);
  const usd = await createCashAccount(token, { name: "Dollar account", currency: "USD", openingBalance: "1000.00" });
  const eur = await createCashAccount(token, { name: "Euro account", currency: "EUR", openingBalance: "500.00" });
  await createCashEvent(token, usd!.id, { description: "Invoice", amount: "500.00", expectedDate: day(5) });
  await createCashEvent(token, usd!.id, { description: "Supplier", amount: "-300.50", expectedDate: day(10) });
  return { token, usdAccountId: usd!.id, eurAccountId: eur!.id };
}

beforeEach(async () => {
  await database().query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
  alice = await person("alice");
  bob = await person("bob");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  emails.length = 0;
  await database().query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
});
afterAll(async () => { await database().end(); });

describe("forecast in the reporting currency", () => {
  it("converts a dollar account into euro with a fresh cached rate and never calls the provider", async () => {
    await seedRates(new Date());
    const double = provider();
    const forecast = (await getForecastInReportingCurrency(alice.token, { accountId: alice.usdAccountId, ...window() }, "EUR", double))!;

    expect(forecast.available).toBe(true);
    if (!forecast.available) throw new Error("unreachable");
    expect(forecast.account.currency).toBe("USD");
    expect(forecast.conversion).toMatchObject({ status: "CURRENT", from: "USD", to: "EUR", factor: "0.8", provider: "ecb", effectiveDate: day(-1) });
    expect(forecast.result.currency).toBe("EUR");
    // (1000 + 500 - 300.50) / 1.25
    expect(forecast.result.openingBalance).toBe("800");
    expect(forecast.result.closingBalance).toBe("959.6");
    expect(double.calls).toBe(0);
  });

  it("applies the workspace threshold in the reporting currency", async () => {
    await seedRates(new Date());
    await saveDangerThreshold(alice.token, "900.00");
    const forecast = (await getForecastInReportingCurrency(alice.token, { accountId: alice.usdAccountId, ...window() }, "EUR", provider()))!;
    if (!forecast.available) throw new Error("unreachable");
    // 800 EUR opening balance is already below 900 EUR; the unconverted 1000 USD would not have been.
    expect(forecast.result.dangerThresholdAmount).toBe("900");
    expect(forecast.result.firstDangerDate).toBe(day(0));
  });

  it("does nothing and says so when the account is already in the reporting currency", async () => {
    const double = provider();
    const forecast = (await getForecastInReportingCurrency(alice.token, { accountId: alice.eurAccountId, ...window() }, "EUR", double))!;
    if (!forecast.available) throw new Error("unreachable");
    expect(forecast.conversion).toEqual({ status: "NONE", from: "EUR", to: "EUR" });
    expect(forecast.result.openingBalance).toBe("500");
    expect(double.calls).toBe(0);
  });

  it("converts a euro account into dollars and a dollar account into Singapore dollars through the cross rate", async () => {
    await seedRates(new Date());
    const toUsd = (await getForecastInReportingCurrency(alice.token, { accountId: alice.eurAccountId, ...window() }, "USD", provider()))!;
    if (!toUsd.available) throw new Error("unreachable");
    expect(toUsd.result.openingBalance).toBe("625");
    const toSgd = (await getForecastInReportingCurrency(alice.token, { accountId: alice.usdAccountId, ...window() }, "SGD", provider()))!;
    if (!toSgd.available) throw new Error("unreachable");
    // 1000 USD / 1.25 EUR/USD * 1.40 EUR/SGD = 1120 SGD
    expect(toSgd.result.openingBalance).toBe("1120");
    expect(toSgd.conversion.status).toBe("CURRENT");
  });

  it("uses the last rate and labels it STALE when the provider is down", async () => {
    await seedRates(new Date(Date.now() - 3 * 60 * 60 * 1000));
    const double = provider();
    const forecast = (await getForecastInReportingCurrency(alice.token, { accountId: alice.usdAccountId, ...window() }, "EUR", double))!;
    if (!forecast.available || forecast.conversion.status !== "STALE") throw new Error(`expected STALE, got ${JSON.stringify(forecast.conversion)}`);
    expect(forecast.conversion.refreshFailure).not.toBeNull();
    expect(forecast.result.openingBalance).toBe("800");
    expect(double.calls).toBeGreaterThan(0);
  });

  it("shows no number at all when there is no usable rate", async () => {
    const forecast = (await getForecastInReportingCurrency(alice.token, { accountId: alice.usdAccountId, ...window() }, "EUR", provider()))!;
    expect(forecast.available).toBe(false);
    expect(forecast).not.toHaveProperty("result");
    expect(forecast.conversion).toMatchObject({ status: "UNAVAILABLE", from: "USD", to: "EUR" });
    expect(forecast.conversion.status === "UNAVAILABLE" && forecast.conversion.failure.message).toBeTruthy();
  });

  it("gives null for another user's account, an unknown id and a malformed id", async () => {
    await seedRates(new Date());
    for (const accountId of [bob.usdAccountId, randomUUID(), "not-a-uuid"]) {
      expect(await getForecastInReportingCurrency(alice.token, { accountId, ...window() }, "EUR", provider()), String(accountId)).toBeNull();
    }
  });
});
