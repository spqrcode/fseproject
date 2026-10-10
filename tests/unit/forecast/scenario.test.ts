import { describe, it, expect, beforeEach } from "vitest";
import {
  parseCashEvent,
  CashEventValidationError,
  type CashEvent,
} from "@/lib/forecast/cash-event";
import {
  runForecast,
  scenarioContribution,
  type ForecastResult,
} from "@/lib/forecast/forecast-engine";
import {
  applyDelayAdjustment,
  runScenarioForecast,
  InvalidAdjustmentError,
  MissingEventError,
  type DelayAdjustment,
} from "@/lib/forecast/scenario";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1;
function makeEvent(
  overrides: Partial<{
    id: string;
    userId: string;
    description: string;
    amount: string;
    currency: string;
    expectedDate: string;
  }> = {},
): CashEvent {
  const id = overrides.id ?? `event-${nextId++}`;
  return parseCashEvent({
    id,
    userId: overrides.userId ?? "user-1",
    description: overrides.description ?? "Test event",
    amount: overrides.amount ?? "100",
    currency: overrides.currency ?? "EUR",
    expectedDate: overrides.expectedDate ?? "2025-01-15",
  });
}

const BASE_INPUT = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  openingBalance: "1000",
  currency: "EUR" as const,
};

// ---------------------------------------------------------------------------
// 1. parseCashEvent validation
// ---------------------------------------------------------------------------

describe("parseCashEvent validation", () => {
  it("parses a valid event and freezes the result", () => {
    const e = makeEvent();
    expect(Object.isFrozen(e)).toBe(true);
    expect(e.amount).toBe("100");
    expect(e.currency).toBe("EUR");
  });

  it("rejects zero-value events", () => {
    expect(() => makeEvent({ amount: "0" })).toThrow(CashEventValidationError);
    expect(() => makeEvent({ amount: "-0" })).toThrow(CashEventValidationError);
  });

  it("rejects unsupported currencies", () => {
    expect(() => makeEvent({ currency: "GBP" })).toThrow();
    expect(() => makeEvent({ currency: "eur" })).toThrow();
  });

  it("rejects malformed dates", () => {
    expect(() => makeEvent({ expectedDate: "2025/01/15" })).toThrow(CashEventValidationError);
    expect(() => makeEvent({ expectedDate: "not-a-date" })).toThrow(CashEventValidationError);
    expect(() => makeEvent({ expectedDate: "2025-13-01" })).toThrow(CashEventValidationError);
  });

  it("rejects empty and untrimmed descriptions", () => {
    expect(() => makeEvent({ description: "" })).toThrow(CashEventValidationError);
    expect(() => makeEvent({ description: "  hello" })).toThrow(CashEventValidationError);
  });

  it("preserves negative amounts for expenses", () => {
    const e = makeEvent({ amount: "-250.50" });
    expect(e.amount).toBe("-250.5");
  });
});

// ---------------------------------------------------------------------------
// 2. Original CashEvent date is unchanged after scenario application
// ---------------------------------------------------------------------------

describe("scenario isolation — original CashEvent is never mutated", () => {
  it("does not change expectedDate on the original CashEvent object", () => {
    const original = makeEvent({ expectedDate: "2025-03-01" });
    const originalDateBefore = original.expectedDate;

    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: original.id,
      dateOverride: "2025-04-15",
      status: "active",
    };

    applyDelayAdjustment(adjustment, [original]);

    // The original event is unchanged
    expect(original.expectedDate).toBe(originalDateBefore);
    expect(original.expectedDate).toBe("2025-03-01");
  });

  it("returns a new array; the original array is not modified", () => {
    const original = makeEvent({ expectedDate: "2025-03-01" });
    const events = [original];

    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: original.id,
      dateOverride: "2025-04-15",
      status: "active",
    };

    const projected = applyDelayAdjustment(adjustment, events);

    expect(projected).not.toBe(events);
    expect(events[0]).toBe(original); // same reference, not a copy
    expect(projected[0]).not.toBe(original); // different reference for the adjusted event
  });

  it("the projected event has the override date while originals are identical for non-adjusted events", () => {
    const e1 = makeEvent({ id: "e1", expectedDate: "2025-03-01" });
    const e2 = makeEvent({ id: "e2", expectedDate: "2025-04-01" });

    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2025-05-01",
      status: "active",
    };

    const projected = applyDelayAdjustment(adjustment, [e1, e2]);

    expect(projected[0].expectedDate).toBe("2025-05-01");
    expect(projected[1]).toBe(e2); // non-adjusted event is the exact same reference
  });
});

// ---------------------------------------------------------------------------
// 3. Persisted CashEvent is unchanged — proven by comparing before/after base forecast
// ---------------------------------------------------------------------------

describe("base forecast immutability", () => {
  let events: CashEvent[];
  let baseForecast: ForecastResult;

  beforeEach(() => {
    events = [
      makeEvent({ id: "e1", amount: "500", expectedDate: "2025-03-01" }),
      makeEvent({ id: "e2", amount: "-200", expectedDate: "2025-06-15" }),
    ];
    baseForecast = runForecast({ ...BASE_INPUT, events });
  });

  it("base forecast closing balance is opening plus net cash events", () => {
    // 1000 + 500 - 200 = 1300
    expect(baseForecast.closingBalance).toBe("1300");
    expect(baseForecast.openingBalance).toBe("1000");
  });

  it("base forecast result is unchanged before and after running a scenario", () => {
    const balanceBefore = baseForecast.closingBalance;
    const minBefore = baseForecast.minimumBalance;

    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2025-07-01",
      status: "active",
    };

    runScenarioForecast({
      scenarioId: "sc-1",
      adjustments: [adjustment],
      baseEvents: events,
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });

    // baseForecast is unchanged
    expect(baseForecast.closingBalance).toBe(balanceBefore);
    expect(baseForecast.minimumBalance).toBe(minBefore);
  });
});

// ---------------------------------------------------------------------------
// 4. Scenario excludes receipt on original date and includes it on delayed date
// ---------------------------------------------------------------------------

describe("scenario date override produces the correct timeline", () => {
  it("excludes the event on its original date and includes it on the delayed date", () => {
    const event = makeEvent({ id: "e1", amount: "300", expectedDate: "2025-03-01" });
    const baseForecast = runForecast({ ...BASE_INPUT, events: [event] });

    // Base: balance rises by 300 on 2025-03-01
    expect(baseForecast.timeline.find((p) => p.date === "2025-03-01")?.balance).toBe("1300");

    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2025-06-01",
      status: "active",
    };

    const projection = runScenarioForecast({
      scenarioId: "sc-1",
      adjustments: [adjustment],
      baseEvents: [event],
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });

    // No entry on the original date
    expect(projection.result.timeline.find((p) => p.date === "2025-03-01")).toBeUndefined();
    // Balance rises on the new date
    expect(projection.result.timeline.find((p) => p.date === "2025-06-01")?.balance).toBe("1300");
    // Closing balance is the same (event still happens, just later)
    expect(projection.result.closingBalance).toBe("1300");
    // Delta is zero because the same amount enters before year-end
    expect(projection.contributionDelta).toBe("0");
  });

  it("when delayed beyond the forecast horizon, the event is excluded from the scenario closing balance", () => {
    const event = makeEvent({ id: "e1", amount: "300", expectedDate: "2025-03-01" });
    const baseForecast = runForecast({ ...BASE_INPUT, events: [event] });

    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2026-01-15", // beyond endDate 2025-12-31
      status: "active",
    };

    const projection = runScenarioForecast({
      scenarioId: "sc-1",
      adjustments: [adjustment],
      baseEvents: [event],
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });

    // Event is not in the scenario at all — closing balance equals opening
    expect(projection.result.closingBalance).toBe("1000");
    // Contribution is negative (lost the 300 inflow)
    expect(projection.contributionDelta).toBe("-300");
  });
});

// ---------------------------------------------------------------------------
// 5. Two scenarios targeting the same event do not affect each other
// ---------------------------------------------------------------------------

describe("two scenarios are independent", () => {
  it("adjusting the same event in two different scenarios does not bleed between them", () => {
    const event = makeEvent({ id: "e1", amount: "400", expectedDate: "2025-03-01" });
    const baseForecast = runForecast({ ...BASE_INPUT, events: [event] });

    const adjustmentA: DelayAdjustment = {
      id: "adj-A",
      scenarioId: "sc-A",
      cashEventId: "e1",
      dateOverride: "2025-05-01",
      status: "active",
    };
    const adjustmentB: DelayAdjustment = {
      id: "adj-B",
      scenarioId: "sc-B",
      cashEventId: "e1",
      dateOverride: "2025-09-01",
      status: "active",
    };

    const projA = runScenarioForecast({
      scenarioId: "sc-A",
      adjustments: [adjustmentA],
      baseEvents: [event],
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });

    const projB = runScenarioForecast({
      scenarioId: "sc-B",
      adjustments: [adjustmentB],
      baseEvents: [event],
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });

    // Each scenario gets its own date
    expect(projA.result.timeline.find((p) => p.date === "2025-05-01")?.balance).toBe("1400");
    expect(projB.result.timeline.find((p) => p.date === "2025-09-01")?.balance).toBe("1400");

    // Neither scenario has the other's date
    expect(projA.result.timeline.find((p) => p.date === "2025-09-01")).toBeUndefined();
    expect(projB.result.timeline.find((p) => p.date === "2025-05-01")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Invalid or cancelled adjustment produces explicit error
// ---------------------------------------------------------------------------

describe("invalid/cancelled adjustment errors", () => {
  it("throws InvalidAdjustmentError when adjustment status is 'invalid'", () => {
    const event = makeEvent();
    const badAdjustment: DelayAdjustment = {
      id: "adj-bad",
      scenarioId: "sc-1",
      cashEventId: event.id,
      dateOverride: "2025-05-01",
      status: "invalid",
    };
    expect(() => applyDelayAdjustment(badAdjustment, [event])).toThrow(InvalidAdjustmentError);
    expect(() => applyDelayAdjustment(badAdjustment, [event])).toThrow("adj-bad");
  });

  it("throws MissingEventError when the referenced event is absent from the list", () => {
    const event = makeEvent({ id: "e1" });
    const orphanAdjustment: DelayAdjustment = {
      id: "adj-orphan",
      scenarioId: "sc-1",
      cashEventId: "nonexistent-id",
      dateOverride: "2025-05-01",
      status: "active",
    };
    expect(() => applyDelayAdjustment(orphanAdjustment, [event])).toThrow(MissingEventError);
    expect(() => applyDelayAdjustment(orphanAdjustment, [event])).toThrow("nonexistent-id");
  });

  it("throws InvalidAdjustmentError when runScenarioForecast encounters an invalid adjustment", () => {
    const event = makeEvent({ id: "e1" });
    const baseForecast = runForecast({ ...BASE_INPUT, events: [event] });
    const badAdjustment: DelayAdjustment = {
      id: "adj-bad",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2025-06-01",
      status: "invalid",
    };
    expect(() =>
      runScenarioForecast({
        scenarioId: "sc-1",
        adjustments: [badAdjustment],
        baseEvents: [event],
        baseForecast,
        startDate: BASE_INPUT.startDate,
        endDate: BASE_INPUT.endDate,
        currency: BASE_INPUT.currency,
      }),
    ).toThrow(InvalidAdjustmentError);
  });
});

// ---------------------------------------------------------------------------
// 7. Scenario contribution delta = scenario balance − base balance
// ---------------------------------------------------------------------------

describe("scenarioContribution delta accuracy", () => {
  it("delta is zero when the adjustment keeps the event within the horizon", () => {
    const event = makeEvent({ id: "e1", amount: "1000", expectedDate: "2025-02-01" });
    const baseForecast = runForecast({ ...BASE_INPUT, events: [event] });
    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2025-11-01",
      status: "active",
    };
    const projection = runScenarioForecast({
      scenarioId: "sc-1",
      adjustments: [adjustment],
      baseEvents: [event],
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });
    expect(projection.contributionDelta).toBe("0");
    expect(projection.result.closingBalance).toBe(baseForecast.closingBalance);
  });

  it("delta equals negative event amount when inflow is pushed beyond the horizon", () => {
    const event = makeEvent({ id: "e1", amount: "750", expectedDate: "2025-02-01" });
    const baseForecast = runForecast({ ...BASE_INPUT, events: [event] });
    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2026-01-01",
      status: "active",
    };
    const projection = runScenarioForecast({
      scenarioId: "sc-1",
      adjustments: [adjustment],
      baseEvents: [event],
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });
    expect(projection.contributionDelta).toBe("-750");
    expect(scenarioContribution(baseForecast, projection.result)).toBe("-750");
  });

  it("delta is positive when an outflow is pushed beyond the horizon (delayed expense)", () => {
    const event = makeEvent({ id: "e1", amount: "-500", expectedDate: "2025-02-01" });
    const baseForecast = runForecast({ ...BASE_INPUT, events: [event] });
    const adjustment: DelayAdjustment = {
      id: "adj-1",
      scenarioId: "sc-1",
      cashEventId: "e1",
      dateOverride: "2026-01-01",
      status: "active",
    };
    const projection = runScenarioForecast({
      scenarioId: "sc-1",
      adjustments: [adjustment],
      baseEvents: [event],
      baseForecast,
      startDate: BASE_INPUT.startDate,
      endDate: BASE_INPUT.endDate,
      currency: BASE_INPUT.currency,
    });
    expect(projection.contributionDelta).toBe("500");
  });
});

// ---------------------------------------------------------------------------
// 8. runForecast is deterministic and handles multiple events on same date
// ---------------------------------------------------------------------------

describe("runForecast determinism and same-day events", () => {
  it("produces the same result for the same input regardless of input order", () => {
    const e1 = makeEvent({ id: "a", amount: "100", expectedDate: "2025-03-01" });
    const e2 = makeEvent({ id: "b", amount: "200", expectedDate: "2025-03-01" });

    const r1 = runForecast({ ...BASE_INPUT, events: [e1, e2] });
    const r2 = runForecast({ ...BASE_INPUT, events: [e2, e1] });

    expect(r1.closingBalance).toBe(r2.closingBalance);
    expect(r1.timeline).toEqual(r2.timeline);
  });

  it("events outside the date range are silently excluded", () => {
    const inRange = makeEvent({ id: "in", amount: "100", expectedDate: "2025-06-01" });
    const before = makeEvent({ id: "before", amount: "999", expectedDate: "2024-12-31" });
    const after = makeEvent({ id: "after", amount: "999", expectedDate: "2026-01-01" });

    const result = runForecast({ ...BASE_INPUT, events: [inRange, before, after] });
    expect(result.closingBalance).toBe("1100");
    expect(result.timeline).toHaveLength(1);
  });

  it("returns frozen results that cannot be mutated", () => {
    const result = runForecast({ ...BASE_INPUT, events: [makeEvent()] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.timeline)).toBe(true);
  });
});
