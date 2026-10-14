import { describe, it, expect } from "vitest";
import { parseCashEvent, runForecast, type CashEvent } from "@/lib/forecast";
import { compareScenario, contributionsAddUp, ContributionMismatchError, CONTRIBUTION_TOLERANCE } from "@/lib/forecast/scenario-comparison";
import { convertForecastInput, fxRate, type ForecastInput } from "@/lib/forecast";
import type { DelayAdjustment } from "@/lib/forecast/scenario";

// Proposal US-05 (US-12 in requirements.md): the difference between the scenario and the base equals the sum of the per-adjustment contributions.

function event(id: string, amount: string, expectedDate: string): CashEvent {
  return parseCashEvent({ id, amount, currency: "EUR", expectedDate, createdAt: "2025-01-01T00:00:00.000Z", status: "pending" });
}
const WINDOW = { startDate: "2025-01-01", endDate: "2025-03-31", currency: "EUR" as const };
const delay = (id: string, cashEventId: string, dateOverride: string, status: DelayAdjustment["status"] = "active"): DelayAdjustment => ({
  id, scenarioId: "sc-1", cashEventId, dateOverride, status,
});
function compare(events: CashEvent[], adjustments: DelayAdjustment[], openingBalance = "1000") {
  const baseForecast = runForecast({ ...WINDOW, openingBalance, dangerThreshold: null, events });
  return compareScenario({ scenarioId: "sc-1", adjustments, baseEvents: events, baseForecast, ...WINDOW });
}

describe("base versus scenario", () => {
  it("shows no difference when the delay stays inside the range, and still has a contribution of zero", () => {
    const events = [event("a", "400", "2025-02-01")];
    const result = compare(events, [delay("adj-a", "a", "2025-02-20")]);
    expect(result.closingDelta).toBe("0");
    expect(result.contributions).toEqual([{ adjustmentId: "adj-a", cashEventId: "a", closingDelta: "0" }]);
    expect(result.contributionsTotal).toBe("0");
    // The lowest point is unchanged too (the opening balance), but the balance in between differs.
    expect(result.base.timeline.find((p) => p.date === "2025-02-10")?.balance).toBe("1400");
    expect(result.scenario.timeline.find((p) => p.date === "2025-02-10")?.balance).toBe("1000");
  });

  it("an invoice delayed beyond the end of the range lowers the closing balance by its amount", () => {
    const events = [event("a", "400", "2025-02-01"), event("b", "250", "2025-03-10")];
    const result = compare(events, [delay("adj-a", "a", "2025-04-15")]);
    expect(result.base.closingBalance).toBe("1650");
    expect(result.scenario.closingBalance).toBe("1250");
    expect(result.closingDelta).toBe("-400");
    expect(result.contributions).toEqual([{ adjustmentId: "adj-a", cashEventId: "a", closingDelta: "-400" }]);
  });

  it("the contributions add up to the difference for several adjustments, some inside and some beyond the range", () => {
    const events = [
      event("a", "400", "2025-02-01"),
      event("b", "250.50", "2025-02-15"),
      event("c", "99.99", "2025-03-01"),
      event("d", "-120", "2025-02-05"),
    ];
    const adjustments = [
      delay("adj-a", "a", "2025-04-01"),   // leaves the range
      delay("adj-b", "b", "2025-03-30"),   // stays inside
      delay("adj-c", "c", "2025-05-01"),   // leaves the range
    ];
    const result = compare(events, adjustments);
    expect(result.closingDelta).toBe("-499.99");
    expect(result.contributions.map((item) => item.closingDelta)).toEqual(["-400", "0", "-99.99"]);
    expect(result.contributionsTotal).toBe(result.closingDelta);
  });

  it("compares the lowest balance and the runway as well", () => {
    // Opening 1000, threshold 50% = 500. An expense of 700 on 10 Feb is covered by an invoice on 5 Feb.
    const events = [event("inv", "600", "2025-02-05"), event("rent", "-700", "2025-02-10")];
    const result = compare(events, [delay("adj-inv", "inv", "2025-02-20")]);
    expect(result.base.minimumBalance).toBe("900");
    expect(result.scenario.minimumBalance).toBe("300");
    expect(result.minimumDelta).toBe("-600");
    expect(result.base.firstDangerDate).toBeNull();
    expect(result.scenario.firstDangerDate).toBe("2025-02-10");
    expect(result.scenario.runwayDays).toBe(40);
  });

  it("reports adjustments that do not apply instead of failing, and still adds up", () => {
    const events = [event("a", "400", "2025-02-01")];
    const result = compare(events, [
      delay("adj-a", "a", "2025-04-01"),
      delay("adj-gone", "settled-event", "2025-04-01", "not_applicable"),
      delay("adj-other", "event-on-another-account", "2025-04-01"),
      delay("adj-bad", "a", "2025-05-01", "invalid"),
    ]);
    expect(result.skipped.map((item) => [item.adjustmentId, item.reason])).toEqual([
      ["adj-gone", "not_applicable"], ["adj-other", "not_in_forecast"], ["adj-bad", "invalid"],
    ]);
    expect(result.contributions.map((item) => item.adjustmentId)).toEqual(["adj-a"]);
    expect(result.closingDelta).toBe("-400");
    expect(result.contributionsTotal).toBe("-400");
  });

  it("equals the base when nothing applies", () => {
    const events = [event("a", "400", "2025-02-01")];
    const result = compare(events, []);
    expect(result.closingDelta).toBe("0");
    expect(result.minimumDelta).toBe("0");
    expect(result.contributions).toEqual([]);
    expect(result.scenario.timeline).toEqual(result.base.timeline);
  });

  it("does not change the events or the base forecast it was given", () => {
    const events = [event("a", "400", "2025-02-01")];
    const baseForecast = runForecast({ ...WINDOW, openingBalance: "1000", dangerThreshold: null, events });
    const snapshot = JSON.stringify({ events, baseForecast });
    compareScenario({ scenarioId: "sc-1", adjustments: [delay("adj-a", "a", "2025-04-01")], baseEvents: events, baseForecast, ...WINDOW });
    expect(JSON.stringify({ events, baseForecast })).toBe(snapshot);
  });

  it("an overdue event that is delayed past the range is also accounted for exactly", () => {
    // Dated before the start, so the engine counts it on the start date; delaying it past the end removes it.
    const events = [event("late", "300", "2024-12-15")];
    const result = compare(events, [delay("adj-late", "late", "2025-05-01")]);
    expect(result.base.closingBalance).toBe("1300");
    expect(result.closingDelta).toBe("-300");
    expect(result.contributionsTotal).toBe("-300");
  });

  it("keeps the two ForecastResult shapes identical so a page can show them side by side", () => {
    const result = compare([event("a", "400", "2025-02-01")], [delay("adj-a", "a", "2025-02-20")]);
    expect(Object.keys(result.scenario).sort()).toEqual(Object.keys(result.base).sort());
    expect(result.scenario.timeline).toHaveLength(result.base.timeline.length);
  });

  it("the mismatch guard exists and carries both numbers", () => {
    const error = new ContributionMismatchError("-400", "-399.99");
    expect(error.closingDelta).toBe("-400");
    expect(error.contributionsTotal).toBe("-399.99");
    expect(error.message).toContain("do not add up");
  });
});

describe("after conversion into the reporting currency", () => {
  // Converted amounts carry the engine's 40 significant digits, so sums round in their last digit. Before the
  // tolerance, these real and synthetic rates made compareScenario throw on a difference around the 34th decimal.
  it.each(["1.4127", "3", "1.123456789", "1.0856", "0.7079"])("still adds up with a rate of %s", rate => {
    const amounts = ["9000", "10000.01", "-7000", "2499.99", "123.45", "8000", "333.33"];
    const events = amounts.map((amount, i) => parseCashEvent({ id: `e${i}`, amount, currency: "USD", expectedDate: `2025-01-${String(5 + i * 3).padStart(2, "0")}`, createdAt: "2025-01-01T00:00:00.000Z", status: "pending" }));
    const input: ForecastInput = { startDate: "2025-01-01", endDate: "2025-03-31", openingBalance: "20000.37", dangerThreshold: null, currency: "USD", events };
    const converted = convertForecastInput(input, "EUR", fxRate("EUR", "USD", rate));
    const baseForecast = runForecast(converted);
    const adjustments = [0, 1, 3, 5, 6].map(i => delay(`a${i}`, `e${i}`, i % 2 ? "2025-05-01" : "2025-03-20"));
    const result = compareScenario({ scenarioId: "sc-1", adjustments, baseEvents: converted.events, baseForecast, startDate: converted.startDate, endDate: converted.endDate, currency: "EUR" });
    expect(result.contributions).toHaveLength(5);
    expect(contributionsAddUp(result.contributionsTotal, result.closingDelta)).toBe(true);
  });

  it("accepts rounding in the last digits but still refuses a real gap", () => {
    expect(CONTRIBUTION_TOLERANCE).toBe("0.0000000001");
    expect(contributionsAddUp("-400", "-400")).toBe(true);
    expect(contributionsAddUp("-14511.21965031499964606781340695122814468", "-14511.21965031499964606781340695122814467")).toBe(true);
    expect(contributionsAddUp("-400.0000000001", "-400")).toBe(true);
    // A cent, a fraction of a cent and a missing invoice are all real errors.
    expect(contributionsAddUp("-399.99", "-400")).toBe(false);
    expect(contributionsAddUp("-400.000000001", "-400")).toBe(false);
    expect(contributionsAddUp("-150", "-400")).toBe(false);
  });
});
