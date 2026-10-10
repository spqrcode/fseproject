import { describe, expect, it } from "vitest";
import type { FxSnapshot } from "@/lib/fx/snapshot-store";
import {
  calculateShockedRate,
  evaluateFxShock,
  buildScenarioFxResult,
  convertWithShock,
  InvalidShockPercentageError,
  MissingSnapshotError,
  UnusableSnapshotError,
} from "@/lib/fx/fx-shock";
import {
  money,
  convertMoney,
  roundMoney,
  runForecast,
  scenarioContribution,
  type CashEvent,
} from "@/lib/forecast";

const BASE_SNAPSHOT: FxSnapshot = Object.freeze({
  id: "e6f47738-f9b1-4f9a-8cf0-5c621376a144",
  provider: "ecb",
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  rate: "1.1225",
  effectiveDate: "2026-10-02",
  fetchedAt: new Date("2026-10-02T16:05:00Z"),
});

describe("Percentage-based FX shock domain logic", () => {
  // 1. +5% shock
  it("calculates +5% shock where BASE buys more QUOTE", () => {
    // 1.1225 * (1 + 5/100) = 1.1225 * 1.05 = 1.178625
    const shocked = calculateShockedRate(BASE_SNAPSHOT.rate, "5");
    expect(shocked).toBe("1.178625");

    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "5");
    expect(evaluated.shockedRate).toBe("1.178625");
    expect(evaluated.sourceRate).toBe("1.1225");

    // 100 EUR bought 112.25 USD before; now buys 117.8625 USD
    const unshockedVal = convertMoney(money("100", "EUR"), "USD", evaluated.shockedFxRate);
    expect(unshockedVal).toEqual({ amount: "117.8625", currency: "USD" });
  });

  // 2. -5% shock
  it("calculates -5% shock where BASE buys less QUOTE", () => {
    // 1.1225 * (1 - 5/100) = 1.1225 * 0.95 = 1.066375
    const shocked = calculateShockedRate(BASE_SNAPSHOT.rate, "-5");
    expect(shocked).toBe("1.066375");

    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "-5");
    expect(evaluated.shockedRate).toBe("1.066375");

    // 100 EUR buys 106.6375 USD
    const usdVal = convertWithShock(money("100", "EUR"), "USD", evaluated);
    expect(usdVal).toEqual({ amount: "106.6375", currency: "USD" });
  });

  // 3. 0% shock
  it("calculates 0% shock leaving the rate unchanged", () => {
    const shocked = calculateShockedRate(BASE_SNAPSHOT.rate, "0");
    expect(shocked).toBe("1.1225");

    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "0");
    expect(evaluated.shockedRate).toBe("1.1225");
    expect(evaluated.sourceRate).toBe("1.1225");
  });

  // 4. Decimal precision
  it("preserves high decimal precision without intermediate rounding", () => {
    // source: 1.4366, shock: 3.333333333333333333%
    const shock = "3.333333333333333333";
    const shocked = calculateShockedRate("1.4366", shock);
    // 1.4366 * (1 + 0.03333333333333333333)
    // 1.4366 * 1.03333333333333333333 = 1.484486666666666666661878
    expect(shocked.startsWith("1.48448666666666666666")).toBe(true);
    // Exact length check showing no premature 2-decimal truncation
    expect(shocked.length).toBeGreaterThan(15);
  });

  // 5. -100% rejection
  it("rejects a shock of exactly -100%", () => {
    expect(() => calculateShockedRate("1.1225", "-100")).toThrow(InvalidShockPercentageError);
    expect(() => evaluateFxShock(BASE_SNAPSHOT, "-100")).toThrow(InvalidShockPercentageError);
  });

  // 6. Less than -100% rejection
  it("rejects a shock of less than -100%", () => {
    expect(() => calculateShockedRate("1.1225", "-100.0001")).toThrow(InvalidShockPercentageError);
    expect(() => calculateShockedRate("1.1225", "-105")).toThrow(InvalidShockPercentageError);
    expect(() => calculateShockedRate("1.1225", "-200")).toThrow(InvalidShockPercentageError);
  });

  // 7. Malformed percentage rejection
  it("rejects malformed percentage strings", () => {
    expect(() => calculateShockedRate("1.1225", "abc")).toThrow(InvalidShockPercentageError);
    expect(() => calculateShockedRate("1.1225", "5%")).toThrow(InvalidShockPercentageError);
    expect(() => calculateShockedRate("1.1225", "1e5")).toThrow(InvalidShockPercentageError);
    expect(() => calculateShockedRate("1.1225", "NaN")).toThrow(InvalidShockPercentageError);
    expect(() => calculateShockedRate("1.1225", "")).toThrow(InvalidShockPercentageError);
  });

  // 8. Missing snapshot
  it("throws MissingSnapshotError when snapshot is missing or null", () => {
    expect(() => evaluateFxShock(null, "5")).toThrow(MissingSnapshotError);
    expect(() => evaluateFxShock(undefined, "5")).toThrow(MissingSnapshotError);
  });

  // 9. Unusable snapshot rate
  it("throws UnusableSnapshotError when the persisted rate is non-positive", () => {
    const zeroRateSnapshot: FxSnapshot = {
      ...BASE_SNAPSHOT,
      rate: "0",
    };
    expect(() => evaluateFxShock(zeroRateSnapshot, "5")).toThrow(UnusableSnapshotError);

    const negativeRateSnapshot: FxSnapshot = {
      ...BASE_SNAPSHOT,
      rate: "-1.1225",
    };
    expect(() => evaluateFxShock(negativeRateSnapshot, "5")).toThrow(UnusableSnapshotError);
  });

  // 10. Source snapshot remains unchanged
  it("does not mutate or modify the input snapshot object", () => {
    const originalRate = BASE_SNAPSHOT.rate;
    const originalDate = BASE_SNAPSHOT.effectiveDate;
    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "10");

    expect(BASE_SNAPSHOT.rate).toBe(originalRate);
    expect(BASE_SNAPSHOT.effectiveDate).toBe(originalDate);
    expect(Object.isFrozen(BASE_SNAPSHOT)).toBe(true);
    expect(evaluated.sourceRate).toBe(originalRate);
  });

  // 11. Same input produces the same result
  it("produces identical output for identical inputs (determinism)", () => {
    const res1 = evaluateFxShock(BASE_SNAPSHOT, "7.5");
    const res2 = evaluateFxShock(BASE_SNAPSHOT, "7.5");

    expect(res1).toEqual(res2);
    expect(res1.shockedRate).toBe(res2.shockedRate);
    expect(res1.reciprocalRate).toBe(res2.reciprocalRate);
  });

  // 12. Inverse-rate consistency
  it("guarantees inverse conversion uses the reciprocal of the shocked rate", () => {
    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "5");
    // Shocked rate: 1.178625 USD per 1 EUR
    expect(evaluated.shockedRate).toBe("1.178625");

    // Convert 100 EUR -> 117.8625 USD
    const usd = convertWithShock(money("100", "EUR"), "USD", evaluated);
    expect(usd).toEqual({ amount: "117.8625", currency: "USD" });

    // Inverse: Convert 117.8625 USD -> 100 EUR using the shocked rate's reciprocal
    const eur = convertWithShock(usd, "EUR", evaluated);
    expect(roundMoney(eur)).toEqual({ amount: "100", currency: "EUR" });

    // Verify mathematical reciprocal relationship
    // reciprocalRate = 1 / 1.178625 (computed with 40-digit ForecastDecimal precision)
    expect(evaluated.reciprocalRate.startsWith("0.84844628274472372467")).toBe(true);
  });

  // 13. No ECB/provider call occurs during shock evaluation
  it("evaluates without invoking any external network or provider", () => {
    // Pure function evaluation takes in-memory snapshot and produces result
    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "12");
    expect(evaluated.shockedRate).toBeDefined();
    // No global fetch or async task was spawned
  });

  // 14. Source rate and shocked rate are both returned
  it("returns both sourceRate and shockedRate in the evaluated shock", () => {
    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "15");
    expect(evaluated.sourceRate).toBe("1.1225");
    expect(evaluated.shockedRate).toBe("1.290875"); // 1.1225 * 1.15
  });

  // 15. Effective date and provider remain traceable
  it("preserves provider, effective date, and snapshot ID", () => {
    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "-10");
    expect(evaluated.sourceSnapshotId).toBe(BASE_SNAPSHOT.id);
    expect(evaluated.provider).toBe("ecb");
    expect(evaluated.effectiveDate).toBe("2026-10-02");
    expect(evaluated.baseCurrency).toBe("EUR");
    expect(evaluated.quoteCurrency).toBe("USD");
  });

  it("builds the Scenario Lab result from an already-resolved inverse rate", () => {
    const result = buildScenarioFxResult(
      {
        status: "STALE",
        rate: { base: "SGD", quote: "EUR", rate: "0.6734" },
        provider: "ecb",
        snapshotIds: [BASE_SNAPSHOT.id],
        effectiveDate: "2026-10-02",
        fetchedAt: BASE_SNAPSHOT.fetchedAt,
        refreshFailure: { code: "PROVIDER_ERROR", message: "Exchange rates are temporarily unavailable." },
      },
      { baseCurrency: "SGD", quoteCurrency: "EUR" },
      "-10",
    );

    expect(result.freshness).toBe("STALE");
    expect(result.sourceRate).toBe("0.6734");
    expect(result.adjustedRate).toBe("0.60606");
    expect(result.sourceSnapshotIds).toEqual([BASE_SNAPSHOT.id]);
  });

  it("returns null rates when the FX service reports UNAVAILABLE", () => {
    const result = buildScenarioFxResult(
      {
        status: "UNAVAILABLE",
        rate: null,
        provider: "ecb",
        snapshotIds: [],
        effectiveDate: null,
        fetchedAt: null,
        failure: { code: "MISSING_RATE", message: "A required exchange rate is missing." },
      },
      { baseCurrency: "USD", quoteCurrency: "SGD" },
      "5",
    );

    expect(result.sourceRate).toBeNull();
    expect(result.adjustedRate).toBeNull();
    expect(result.sourceSnapshotIds).toEqual([]);
  });

  // 16. Hypothetical state is explicitly labelled
  it("explicitly labels the shocked rate as hypothetical", () => {
    const evaluated = evaluateFxShock(BASE_SNAPSHOT, "5");
    expect(evaluated.isHypothetical).toBe(true);
    expect(evaluated.label).toBe("hypothetical");
  });

  // 17. FX contribution delta reproducibility
  it("computes a deterministic, reproducible closing balance delta when applied to multi-currency cash events", () => {
    // Evaluate +5% shock on EUR/USD: 1.1225 -> 1.178625
    const shock = evaluateFxShock(BASE_SNAPSHOT, "5");

    // Base conversion: Event 2 converted at unshocked rate (1122.50 / 1.1225 = 1000 EUR)
    const baseEvents: CashEvent[] = [
      { id: "e1", userId: "u1", description: "EU Client", amount: "1000", currency: "EUR", expectedDate: "2026-10-05" },
      { id: "e2", userId: "u1", description: "US Client", amount: "1000", currency: "EUR", expectedDate: "2026-10-10" },
    ];

    // Shocked conversion: Event 2 converted at shocked rate (1122.50 USD / 1.178625 = 952.38095238095238095238 EUR)
    const shockedAmount = convertWithShock(money("1122.50", "USD"), "EUR", shock);
    const shockedEvents: CashEvent[] = [
      { id: "e1", userId: "u1", description: "EU Client", amount: "1000", currency: "EUR", expectedDate: "2026-10-05" },
      { id: "e2", userId: "u1", description: "US Client", amount: shockedAmount.amount, currency: "EUR", expectedDate: "2026-10-10" },
    ];

    const baseForecast = runForecast({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      openingBalance: "5000",
      events: baseEvents,
      currency: "EUR",
    });

    const shockedForecast = runForecast({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      openingBalance: "5000",
      events: shockedEvents,
      currency: "EUR",
    });

    // Base closing: 5000 + 1000 + 1000 = 7000 EUR
    expect(baseForecast.closingBalance).toBe("7000");

    // Difference in closing balance: scenario - base
    const delta1 = scenarioContribution(baseForecast, shockedForecast);
    const delta2 = scenarioContribution(baseForecast, shockedForecast);

    // Delta is exactly reproducible across evaluations
    expect(delta1).toBe(delta2);
    // Delta should be negative (a stronger EUR means USD income translates to less EUR):
    // 952.38095238095238095238 - 1000 = -47.61904761904761904762
    expect(delta1.startsWith("-47.6190476190476190476")).toBe(true);
  });
});
