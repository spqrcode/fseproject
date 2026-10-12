import { describe, it, expect, beforeEach } from "vitest";
import {
  parseCashEvent,
  CashEventValidationError,
  type CashEvent,
} from "@/lib/forecast/cash-event";
import {
  runForecast,
  type ForecastResult,
} from "@/lib/forecast/forecast-engine";
import {
  applyDelayAdjustment,
  runScenarioForecast,
  scenarioContribution,
  InvalidAdjustmentError,
  MissingEventError,
  partitionAdjustments,
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
    amount: string;
    currency: string;
    expectedDate: string;
  }> = {},
): CashEvent {
  const id = overrides.id ?? `event-${nextId++}`;
  return parseCashEvent({
    id,
    amount: overrides.amount ?? "100",
    currency: overrides.currency ?? "EUR",
    expectedDate: overrides.expectedDate ?? "2025-01-15",
    createdAt: "2025-01-01T00:00:00.000Z",
    status: "pending",
  });
}

const BASE_INPUT = {
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  openingBalance: "1000",
  dangerThreshold: null,
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

    // The engine returns every day; the balance stays unchanged on the original date.
    expect(projection.result.timeline.find((p) => p.date === "2025-03-01")?.balance).toBe("1000");
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

    // Both timelines have every day, but the other scenario's date does not trigger a new receipt.
    expect(projA.result.timeline.find((p) => p.date === "2025-09-01")?.balance).toBe("1400");
    expect(projB.result.timeline.find((p) => p.date === "2025-05-01")?.balance).toBe("1000");
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

  it("applyDelayAdjustment also refuses an adjustment whose event is no longer expected", () => {
    const event = makeEvent({ id: "e1" });
    const settled: DelayAdjustment = {
      id: "adj-settled", scenarioId: "sc-1", cashEventId: "e1", dateOverride: "2025-05-01", status: "not_applicable",
    };
    expect(() => applyDelayAdjustment(settled, [event])).toThrow(InvalidAdjustmentError);
  });
});

// ---------------------------------------------------------------------------
// 6b. An adjustment that cannot apply must not break the scenario, and is reported
// ---------------------------------------------------------------------------

describe("adjustments that do not apply to a forecast", () => {
  const params = (adjustments: DelayAdjustment[], baseEvents: ReturnType<typeof makeEvent>[]) => ({
    scenarioId: "sc-1",
    adjustments,
    baseEvents,
    baseForecast: runForecast({ ...BASE_INPUT, events: baseEvents }),
    startDate: BASE_INPUT.startDate,
    endDate: BASE_INPUT.endDate,
    currency: BASE_INPUT.currency,
  });
  const delay = (id: string, cashEventId: string, status: DelayAdjustment["status"] = "active"): DelayAdjustment => ({
    id, scenarioId: "sc-1", cashEventId, dateOverride: "2025-06-01", status,
  });

  it("skips an invalid adjustment instead of throwing and says why", () => {
    const event = makeEvent({ id: "e1", amount: "1000", expectedDate: "2025-02-01" });
    const projection = runScenarioForecast(params([delay("adj-bad", "e1", "invalid")], [event]));
    expect(projection.contributionDelta).toBe("0");
    expect(projection.skipped).toEqual([{ adjustmentId: "adj-bad", cashEventId: "e1", reason: "invalid" }]);
  });

  it("skips an adjustment whose event has been settled since it was saved", () => {
    // The settled event is no longer returned as an expected event, so only e2 is in the forecast.
    const kept = makeEvent({ id: "e2", amount: "500", expectedDate: "2025-02-10" });
    const projection = runScenarioForecast(params([delay("adj-settled", "e1", "not_applicable"), delay("adj-ok", "e2")], [kept]));
    expect(projection.skipped).toEqual([{ adjustmentId: "adj-settled", cashEventId: "e1", reason: "not_applicable" }]);
    // The other adjustment is still applied: e2 moves to 1 June, which is inside the horizon, so the delta is zero
    // but the balance on 10 February no longer includes it.
    expect(projection.result.timeline.find((point) => point.date === "2025-02-10")?.balance)
      .toBe(runForecast({ ...BASE_INPUT, events: [] }).timeline.find((point) => point.date === "2025-02-10")?.balance);
  });

  it("skips an adjustment for an event that is not in this forecast's event list, such as another account's", () => {
    const here = makeEvent({ id: "e1", amount: "400", expectedDate: "2025-02-01" });
    const projection = runScenarioForecast(params([delay("adj-other", "event-on-another-account"), delay("adj-here", "e1")], [here]));
    expect(projection.skipped).toEqual([{ adjustmentId: "adj-other", cashEventId: "event-on-another-account", reason: "not_in_forecast" }]);
    expect(projection.skipped).toHaveLength(1);
  });

  it("reports nothing skipped when every adjustment applies", () => {
    const event = makeEvent({ id: "e1", amount: "1000", expectedDate: "2025-02-01" });
    expect(runScenarioForecast(params([delay("adj-ok", "e1")], [event])).skipped).toEqual([]);
  });

  it("partitionAdjustments is pure: it does not change its inputs", () => {
    const event = makeEvent({ id: "e1" });
    const adjustments = [delay("a", "e1"), delay("b", "gone"), delay("c", "e1", "invalid")];
    const copy = JSON.stringify(adjustments);
    const { applicable, skipped } = partitionAdjustments(adjustments, [event]);
    expect(applicable.map((item) => item.id)).toEqual(["a"]);
    expect(skipped.map((item) => item.reason)).toEqual(["not_in_forecast", "invalid"]);
    expect(JSON.stringify(adjustments)).toBe(copy);
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

  it("moves overdue pending events to the start and excludes events after the range", () => {
    const inRange = makeEvent({ id: "in", amount: "100", expectedDate: "2025-06-01" });
    const before = makeEvent({ id: "before", amount: "999", expectedDate: "2024-12-31" });
    const after = makeEvent({ id: "after", amount: "999", expectedDate: "2026-01-01" });

    const result = runForecast({ ...BASE_INPUT, events: [inRange, before, after] });
    expect(result.closingBalance).toBe("2099");
    expect(result.timeline[0]).toEqual({ date: "2025-01-01", balance: "1999" });
    expect(result.timeline).toHaveLength(365);
  });

  it("returns frozen results that cannot be mutated", () => {
    const result = runForecast({ ...BASE_INPUT, events: [makeEvent()] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.timeline)).toBe(true);
  });
});
