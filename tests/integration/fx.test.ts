/**
 * Integration tests for FX rate persistence and caching against a real PostgreSQL database.
 *
 * Verifies:
 *  1. Snapshot persistence in real PostgreSQL table `fx_snapshots`
 *  2. Effective-date persistence across DB round-trip
 *  3. Duplicate fetch is idempotent via unique constraint
 *  4. Cache hit avoids provider call
 *  5. Provider timeout/failure falls back to STALE snapshot
 *  6. Provider failure without cache returns UNAVAILABLE
 *  7. Cross-rate calculation and EUR conversions with DB-backed rates
 */

import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { database } from "@/lib/db";
import {
  upsertSnapshot,
  findRecentSnapshot,
} from "@/lib/fx/snapshot-store";
import {
  getEurRate,
  getCrossRate,
  CACHE_TTL_MS,
} from "@/lib/fx/rate-service";
import type { EcbProvider, EcbFetchResult } from "@/lib/fx/ecb-provider";
import { convertMoney, money, roundMoney } from "@/lib/forecast";

// ---------------------------------------------------------------------------
// Guard: must run against the isolated test database
// ---------------------------------------------------------------------------
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test") || process.env.DATABASE_URL !== url) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}

// ---------------------------------------------------------------------------
// Mock Next.js headers (required by server-only imports)
// ---------------------------------------------------------------------------
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "http://localhost:3100" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PROVIDER = "ecb";

const FIXTURE_CSV = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1225
`.trim();

function createMockProvider(result: EcbFetchResult): EcbProvider & { fetchCount: number } {
  let count = 0;
  return {
    get fetchCount() {
      return count;
    },
    async fetchRates() {
      count++;
      return result;
    },
  };
}

describe("FX snapshot persistence & cache (PostgreSQL)", () => {
  beforeEach(async () => {
    // Clean test snapshots before each test
    await database().query("DELETE FROM fx_snapshots WHERE provider = $1", [TEST_PROVIDER]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database().query("DELETE FROM fx_snapshots WHERE provider = $1", [TEST_PROVIDER]);
  });

  afterAll(async () => {
    await database().end();
  });

  it("persists snapshot with full precision, effective date, and accepted state", async () => {
    const fetchedAt = new Date();
    const snapshot = await upsertSnapshot(
      TEST_PROVIDER,
      {
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.1225",
        effectiveDate: "2026-10-02",
      },
      fetchedAt,
    );

    expect(snapshot.id).toBeDefined();
    expect(snapshot.provider).toBe(TEST_PROVIDER);
    expect(snapshot.baseCurrency).toBe("EUR");
    expect(snapshot.quoteCurrency).toBe("USD");
    expect(snapshot.rate).toBe("1.1225");
    expect(snapshot.effectiveDate).toBe("2026-10-02");
    expect(snapshot.state).toBe("accepted");
    expect(snapshot.rejectionReason).toBeNull();

    // Verify row directly in PostgreSQL
    const dbCheck = await database().query(
      "SELECT id, rate::text, effective_date::text FROM fx_snapshots WHERE id = $1",
      [snapshot.id],
    );
    expect(dbCheck.rows).toHaveLength(1);
    expect(dbCheck.rows[0].rate).toBe("1.122500000000000"); // NUMERIC(30,15)
    expect(dbCheck.rows[0].effective_date).toBe("2026-10-02");
  });

  it("preserves effective date exactly across round-trip without timezone distortion", async () => {
    const fetchedAt = new Date();
    await upsertSnapshot(
      TEST_PROVIDER,
      {
        baseCurrency: "EUR",
        quoteCurrency: "SGD",
        rate: "1.4366",
        effectiveDate: "2026-10-02",
      },
      fetchedAt,
    );

    const found = await findRecentSnapshot(TEST_PROVIDER, "EUR", "SGD", CACHE_TTL_MS);
    expect(found).not.toBeNull();
    expect(found?.effectiveDate).toBe("2026-10-02");
  });

  it("duplicate fetch is idempotent and updates fetched_at without creating duplicate rows", async () => {
    const t1 = new Date(Date.now() - 10_000);
    const s1 = await upsertSnapshot(
      TEST_PROVIDER,
      {
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.1225",
        effectiveDate: "2026-10-02",
      },
      t1,
    );

    const t2 = new Date();
    const s2 = await upsertSnapshot(
      TEST_PROVIDER,
      {
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.1225",
        effectiveDate: "2026-10-02",
      },
      t2,
    );

    expect(s2.id).toBe(s1.id); // Same row updated
    expect(new Date(s2.fetchedAt).getTime()).toBeGreaterThanOrEqual(new Date(s1.fetchedAt).getTime());

    // Only one row exists in PostgreSQL
    const countRes = await database().query(
      "SELECT COUNT(*)::int AS count FROM fx_snapshots WHERE provider = $1 AND quote_currency = 'USD'",
      [TEST_PROVIDER],
    );
    expect(countRes.rows[0].count).toBe(1);
  });

  it("cache hit avoids calling provider on subsequent getEurRate calls", async () => {
    const provider = createMockProvider({
      ok: true,
      csv: FIXTURE_CSV,
      fetchedAt: new Date(),
    });

    // First call: populates cache from provider
    const first = await getEurRate("USD", provider);
    expect(first.status).toBe("CURRENT");
    expect(provider.fetchCount).toBe(1);

    // Second call: served from DB cache without calling provider
    const second = await getEurRate("USD", provider);
    expect(second.status).toBe("CURRENT");
    expect(provider.fetchCount).toBe(1); // Provider count unchanged
  });

  it("provider timeout with cached snapshot returns STALE", async () => {
    // Seed an expired snapshot directly into Postgres
    const staleFetchedAt = new Date(Date.now() - CACHE_TTL_MS - 30_000);
    await database().query(
      `INSERT INTO fx_snapshots
         (provider, base_currency, quote_currency, rate, effective_date, fetched_at, state)
       VALUES ($1, 'EUR', 'USD', 1.1200, '2026-10-01', $2, 'accepted')`,
      [TEST_PROVIDER, staleFetchedAt],
    );

    // Provider times out on refresh attempt
    const timeoutProvider = createMockProvider({
      ok: false,
      reason: "ECB request timed out after 10000ms",
      fetchedAt: new Date(),
    });

    const res = await getEurRate("USD", timeoutProvider);
    expect(res.status).toBe("STALE");
    if (res.status === "UNAVAILABLE") return;

    expect(res.rate.rate).toBe("1.12");
    expect(res.effectiveDate).toBe("2026-10-01");
  });

  it("provider timeout without cache returns UNAVAILABLE", async () => {
    const timeoutProvider = createMockProvider({
      ok: false,
      reason: "ECB request timed out after 10000ms",
      fetchedAt: new Date(),
    });

    const res = await getEurRate("USD", timeoutProvider);
    expect(res.status).toBe("UNAVAILABLE");
  });

  it("derives accurate cross rates and performs money conversions with DB-backed rates", async () => {
    const provider = createMockProvider({
      ok: true,
      csv: FIXTURE_CSV,
      fetchedAt: new Date(),
    });

    const cross = await getCrossRate("USD", "SGD", provider);
    expect(cross.status).toBe("CURRENT");
    if (cross.status === "UNAVAILABLE") return;

    expect(cross.rate.base).toBe("USD");
    expect(cross.rate.quote).toBe("SGD");
    expect(cross.effectiveDate).toBe("2026-10-02");

    // Convert 112.25 USD -> 143.66 SGD
    const converted = convertMoney(money("112.25", "USD"), "SGD", cross.rate);
    expect(roundMoney(converted)).toEqual({ amount: "143.66", currency: "SGD" });
  });
});
