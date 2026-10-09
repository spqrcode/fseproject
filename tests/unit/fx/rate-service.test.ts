import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { EcbProvider, EcbFetchResult } from "@/lib/fx/ecb-provider";
import {
  getEurRate,
  getCrossRate,
  getRate,
  getAllEcbRates,
  CACHE_TTL_MS,
  ECB_PROVIDER,
  FxRateError,
} from "@/lib/fx/rate-service";
import { convertMoney, money, roundMoney } from "@/lib/forecast";

// ---------------------------------------------------------------------------
// In-memory snapshot database mock
// ---------------------------------------------------------------------------

interface MockSnapshotRow {
  id: string;
  provider: string;
  base_currency: string;
  quote_currency: string;
  rate: string;
  effective_date: string;
  fetched_at: Date;
}

const mockDbRows: MockSnapshotRow[] = [];

vi.mock("@/lib/db", () => ({
  database: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      const sqlNorm = sql.replace(/\s+/g, " ").trim();

      // INSERT / UPSERT
      if (sqlNorm.startsWith("INSERT INTO fx_snapshots")) {
        const [provider, payloadJson, fetchedAt] = params as [string, string, Date];
        const payload = JSON.parse(payloadJson) as Array<{
          base_currency: string;
          quote_currency: string;
          rate: string;
          effective_date: string;
        }>;
        const rows = payload.map((input) => {
          const existing = mockDbRows.find(
            (row) =>
              row.provider === provider &&
              row.base_currency === input.base_currency &&
              row.quote_currency === input.quote_currency &&
              row.effective_date === input.effective_date,
          );
          if (existing) {
            if (fetchedAt >= existing.fetched_at) {
              existing.rate = input.rate;
              existing.fetched_at = fetchedAt;
            }
            return { ...existing };
          }
          const row: MockSnapshotRow = {
            id: randomUUID(),
            provider,
            base_currency: input.base_currency,
            quote_currency: input.quote_currency,
            rate: input.rate,
            effective_date: input.effective_date,
            fetched_at: fetchedAt,
          };
          mockDbRows.push(row);
          return { ...row };
        });
        return { rows };
      }

      // SELECT findRecentSnapshot
      if (sqlNorm.includes("fetched_at >= $4")) {
        const [provider, base, quote, cutoff] = params as [string, string, string, Date];
        const matching = mockDbRows
          .filter(
            (r) =>
              r.provider === provider &&
              r.base_currency === base &&
              r.quote_currency === quote &&
              r.fetched_at.getTime() >= cutoff.getTime(),
          )
          .sort((a, b) => b.fetched_at.getTime() - a.fetched_at.getTime());

        return { rows: matching[0] ? [{ ...matching[0] }] : [] };
      }

      // SELECT findLatestSnapshot
      if (sqlNorm.includes("SELECT id, provider, base_currency, quote_currency")) {
        const [provider, base, quote] = params as [string, string, string];
        const matching = mockDbRows
          .filter(
            (r) =>
              r.provider === provider &&
              r.base_currency === base &&
              r.quote_currency === quote,
          )
          .sort((a, b) => b.fetched_at.getTime() - a.fetched_at.getTime());

        return { rows: matching[0] ? [{ ...matching[0] }] : [] };
      }

      return { rows: [] };
    },
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FX rate service", () => {
  beforeEach(() => {
    mockDbRows.length = 0;
    vi.restoreAllMocks();
  });

  describe("caching and freshness", () => {
    it("fetches, parses, persists, and returns CURRENT on initial cache miss", async () => {
      const now = new Date();
      const provider = createMockProvider({ ok: true, csv: FIXTURE_CSV, fetchedAt: now });

      const res = await getEurRate("USD", provider);
      expect(provider.fetchCount).toBe(1);
      expect(res.status).toBe("CURRENT");
      if (res.status === "UNAVAILABLE") return;

      expect(res.rate.base).toBe("EUR");
      expect(res.rate.quote).toBe("USD");
      expect(res.rate.rate).toBe("1.1225");
      expect(res.provider).toBe(ECB_PROVIDER);
      expect(res.snapshotIds).toHaveLength(1);
      expect(res.effectiveDate).toBe("2026-10-02");
      expect(res.fetchedAt).toEqual(now);
      expect(res.refreshFailure).toBeNull();

      // Verify row persisted in DB
      expect(mockDbRows).toHaveLength(2); // Both USD and SGD were persisted
      const persistedUsd = mockDbRows.find((r) => r.quote_currency === "USD");
      expect(persistedUsd).toBeDefined();
      expect(persistedUsd?.rate).toBe("1.1225");
      expect(persistedUsd?.effective_date).toBe("2026-10-02");
    });

    it("cache hit avoids provider call", async () => {
      // Seed a fresh snapshot into the database
      const now = new Date();
      mockDbRows.push({
        id: randomUUID(),
        provider: ECB_PROVIDER,
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.1225",
        effective_date: "2026-10-02",
        fetched_at: now,
      });

      const provider = createMockProvider({ ok: true, csv: FIXTURE_CSV, fetchedAt: new Date() });

      const res = await getEurRate("USD", provider);
      expect(provider.fetchCount).toBe(0); // Provider was never invoked
      expect(res.status).toBe("CURRENT");
      if (res.status === "UNAVAILABLE") return;

      expect(res.rate.rate).toBe("1.1225");
      expect(res.effectiveDate).toBe("2026-10-02");
    });

    it("duplicate fetch is idempotent and updates fetched_at", async () => {
      const t1 = new Date(Date.now() - 5000);
      const t2 = new Date();
      const p1 = createMockProvider({ ok: true, csv: FIXTURE_CSV, fetchedAt: t1 });
      const p2 = createMockProvider({ ok: true, csv: FIXTURE_CSV, fetchedAt: t2 });

      await getEurRate("USD", p1);
      expect(mockDbRows).toHaveLength(2);
      const rowT1 = mockDbRows.find((r) => r.quote_currency === "USD")!;
      expect(rowT1.fetched_at).toEqual(t1);

      // Expire cache manually to force a second fetch
      rowT1.fetched_at = new Date(Date.now() - CACHE_TTL_MS - 1000);

      await getEurRate("USD", p2);
      expect(mockDbRows).toHaveLength(2); // Row count unchanged (no duplicates)
      const rowT2 = mockDbRows.find((r) => r.quote_currency === "USD")!;
      expect(rowT2.fetched_at).toEqual(t2); // fetched_at was refreshed
    });
  });

  describe("failure and fallback behavior", () => {
    it("provider timeout with cache returns STALE", async () => {
      const staleFetchedAt = new Date(Date.now() - CACHE_TTL_MS - 10_000);
      mockDbRows.push({
        id: randomUUID(),
        provider: ECB_PROVIDER,
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.1200",
        effective_date: "2026-10-01",
        fetched_at: staleFetchedAt,
      });

      const timeoutProvider = createMockProvider({
        ok: false,
        reason: "ECB request timed out after 10000ms",
        fetchedAt: new Date(),
      });

      const res = await getEurRate("USD", timeoutProvider);
      expect(timeoutProvider.fetchCount).toBe(1);
      expect(res.status).toBe("STALE");
      if (res.status === "UNAVAILABLE") return;

      expect(res.rate.rate).toBe("1.12");
      expect(res.effectiveDate).toBe("2026-10-01");
      expect(res.fetchedAt).toEqual(staleFetchedAt);
      expect(res.refreshFailure?.code).toBe("PROVIDER_ERROR");
    });

    it("provider timeout without cache returns UNAVAILABLE", async () => {
      const timeoutProvider = createMockProvider({
        ok: false,
        reason: "ECB request timed out after 10000ms",
        fetchedAt: new Date(),
      });

      const res = await getEurRate("USD", timeoutProvider);
      expect(timeoutProvider.fetchCount).toBe(1);
      expect(res.status).toBe("UNAVAILABLE");
      if (res.status !== "UNAVAILABLE") return;
      expect(res.rate).toBeNull();
      expect(res.effectiveDate).toBeNull();
      expect(res.snapshotIds).toEqual([]);
      expect(res.failure.code).toBe("PROVIDER_ERROR");
    });

    it("returns INVALID_RESPONSE when ECB data is malformed and no cache exists", async () => {
      const provider = createMockProvider({
        ok: true,
        csv: "not,valid,ecb,data",
        fetchedAt: new Date(),
      });

      const res = await getEurRate("USD", provider);
      expect(res.status).toBe("UNAVAILABLE");
      if (res.status !== "UNAVAILABLE") return;
      expect(res.failure.code).toBe("INVALID_RESPONSE");
      expect(mockDbRows).toEqual([]);
    });

    it("provider unexpected exception with cache returns STALE", async () => {
      const staleFetchedAt = new Date(Date.now() - CACHE_TTL_MS - 5000);
      mockDbRows.push({
        id: randomUUID(),
        provider: ECB_PROVIDER,
        base_currency: "EUR",
        quote_currency: "SGD",
        rate: "1.4300",
        effective_date: "2026-10-01",
        fetched_at: staleFetchedAt,
      });

      const throwingProvider: EcbProvider = {
        async fetchRates() {
          throw new Error("Network connection reset");
        },
      };

      const res = await getEurRate("SGD", throwingProvider);
      expect(res.status).toBe("STALE");
      if (res.status === "UNAVAILABLE") return;
      expect(res.rate.rate).toBe("1.43");
      expect(res.effectiveDate).toBe("2026-10-01");
    });

    it("provider unexpected exception without cache returns UNAVAILABLE", async () => {
      const throwingProvider: EcbProvider = {
        async fetchRates() {
          throw new Error("DNS resolution failed");
        },
      };

      const res = await getEurRate("SGD", throwingProvider);
      expect(res.status).toBe("UNAVAILABLE");
    });
  });

  describe("cross-rate calculation and state propagation", () => {
    it("computes accurate USD/SGD cross rate and returns CURRENT when both legs fresh", async () => {
      const provider = createMockProvider({
        ok: true,
        csv: FIXTURE_CSV,
        fetchedAt: new Date(),
      });

      const res = await getCrossRate("USD", "SGD", provider);
      expect(res.status).toBe("CURRENT");
      if (res.status === "UNAVAILABLE") return;

      expect(res.rate.base).toBe("USD");
      expect(res.rate.quote).toBe("SGD");
      // USD -> SGD = 1.4366 / 1.1225
      expect(res.rate.rate.startsWith("1.27982182628")).toBe(true);
      expect(res.effectiveDate).toBe("2026-10-02");

      // Verify conversion
      const converted = convertMoney(money("112.25", "USD"), "SGD", res.rate);
      expect(roundMoney(converted)).toEqual({ amount: "143.66", currency: "SGD" });
    });

    it("returns STALE when either leg is stale", async () => {
      // USD is fresh
      mockDbRows.push({
        id: randomUUID(),
        provider: ECB_PROVIDER,
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.1225",
        effective_date: "2026-10-02",
        fetched_at: new Date(),
      });

      // SGD is stale
      const staleDate = new Date(Date.now() - CACHE_TTL_MS - 20_000);
      mockDbRows.push({
        id: randomUUID(),
        provider: ECB_PROVIDER,
        base_currency: "EUR",
        quote_currency: "SGD",
        rate: "1.4300",
        effective_date: "2026-10-02",
        fetched_at: staleDate,
      });

      // Provider fails on refresh attempt for SGD
      const failingProvider = createMockProvider({
        ok: false,
        reason: "503 Service Unavailable",
        fetchedAt: new Date(),
      });

      const res = await getCrossRate("USD", "SGD", failingProvider);
      expect(res.status).toBe("STALE");
      if (res.status === "UNAVAILABLE") return;

      expect(res.effectiveDate).toBe("2026-10-02");
    });

    it("does not derive a cross-rate from snapshots with different effective dates", async () => {
      const staleFetchedAt = new Date(Date.now() - CACHE_TTL_MS - 20_000);
      mockDbRows.push(
        {
          id: randomUUID(), provider: ECB_PROVIDER, base_currency: "EUR",
          quote_currency: "USD", rate: "1.12", effective_date: "2026-10-02",
          fetched_at: staleFetchedAt,
        },
        {
          id: randomUUID(), provider: ECB_PROVIDER, base_currency: "EUR",
          quote_currency: "SGD", rate: "1.43", effective_date: "2026-10-01",
          fetched_at: staleFetchedAt,
        },
      );
      const provider = createMockProvider({
        ok: false,
        reason: "503 Service Unavailable",
        fetchedAt: new Date(),
      });

      const res = await getCrossRate("USD", "SGD", provider);

      expect(res.status).toBe("UNAVAILABLE");
      if (res.status !== "UNAVAILABLE") return;
      expect(res.rate).toBeNull();
      expect(res.failure.code).toBe("MISMATCHED_EFFECTIVE_DATE");
      expect(provider.fetchCount).toBe(1);
    });

    it("returns UNAVAILABLE if either leg is UNAVAILABLE", async () => {
      // Only USD is present; SGD has no snapshot
      mockDbRows.push({
        id: randomUUID(),
        provider: ECB_PROVIDER,
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.1225",
        effective_date: "2026-10-02",
        fetched_at: new Date(),
      });

      const failingProvider = createMockProvider({
        ok: false,
        reason: "Network timeout",
        fetchedAt: new Date(),
      });

      const res = await getCrossRate("USD", "SGD", failingProvider);
      expect(res.status).toBe("UNAVAILABLE");
      expect(failingProvider.fetchCount).toBe(1);
    });

    it("rejects same currency pair in getCrossRate", async () => {
      await expect(getCrossRate("USD", "USD")).rejects.toThrow(FxRateError);
    });
  });

  describe("general getRate and getAllEcbRates", () => {
    it("handles reciprocal rate for quote=EUR with inverted rate", async () => {
      const now = new Date();
      mockDbRows.push({
        id: randomUUID(),
        provider: ECB_PROVIDER,
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.1225",
        effective_date: "2026-10-02",
        fetched_at: now,
      });

      const res = await getRate("USD", "EUR");
      expect(res.status).toBe("CURRENT");
      if (res.status === "UNAVAILABLE") return;

      expect(res.rate.base).toBe("USD");
      expect(res.rate.quote).toBe("EUR");
      // 1 / 1.1225 = 0.89086859688196...
      expect(res.rate.rate.startsWith("0.89086859688")).toBe(true);

      const converted = convertMoney(money("112.25", "USD"), "EUR", res.rate);
      expect(roundMoney(converted)).toEqual({ amount: "100", currency: "EUR" });
    });

    it("throws FxRateError if base === quote in getRate", async () => {
      await expect(getRate("EUR", "EUR")).rejects.toThrow(FxRateError);
      await expect(getRate("USD", "USD")).rejects.toThrow(FxRateError);
      await expect(getRate("SGD", "SGD")).rejects.toThrow(FxRateError);
    });

    it("returns UNAVAILABLE for unsupported currencies", async () => {
      // @ts-expect-error test unsupported currency at runtime
      const res = await getRate("GBP", "EUR");
      expect(res.status).toBe("UNAVAILABLE");
      if (res.status !== "UNAVAILABLE") return;
      expect(res.failure.code).toBe("UNSUPPORTED_PAIR");
    });

    it("getAllEcbRates fetches both currencies and leverages cache sequentially", async () => {
      const provider = createMockProvider({
        ok: true,
        csv: FIXTURE_CSV,
        fetchedAt: new Date(),
      });

      const all = await getAllEcbRates(provider);
      // Provider is called only once because getEurRate("USD") populates both USD and SGD in DB
      expect(provider.fetchCount).toBe(1);
      expect(all.USD.status).toBe("CURRENT");
      expect(all.SGD.status).toBe("CURRENT");
    });
  });
});
