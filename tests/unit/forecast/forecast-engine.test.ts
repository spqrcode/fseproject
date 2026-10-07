import { describe, expect, it } from "vitest";
import { parseCashEvent, type CashEvent, type RawCashEvent } from "@/lib/forecast/cash-event";
import {
  DANGER_THRESHOLD_PERCENT,
  ForecastInputError,
  runForecast,
} from "@/lib/forecast/forecast-engine";
import { CurrencyMismatchError } from "@/lib/forecast/money";

let eventNumber = 0;

function cashEvent(overrides: Partial<RawCashEvent> = {}): CashEvent {
  eventNumber += 1;
  return parseCashEvent({
    id: `event-${eventNumber}`,
    userId: "user-1",
    description: "Forecast event",
    amount: "100",
    currency: "EUR",
    expectedDate: "2026-01-02",
    createdAt: `2025-12-01T00:00:${String(eventNumber).padStart(2, "0")}.000Z`,
    status: "pending",
    ...overrides,
  });
}

function input(overrides: Partial<Parameters<typeof runForecast>[0]> = {}) {
  return {
    startDate: "2026-01-01",
    endDate: "2026-01-03",
    openingBalance: "1000",
    events: [] as readonly CashEvent[],
    currency: "EUR" as const,
    ...overrides,
  };
}

describe("runForecast timeline", () => {
  it("returns one end-of-day point for every date in the inclusive range", () => {
    const result = runForecast(input());

    expect(result.timeline).toEqual([
      { date: "2026-01-01", balance: "1000" },
      { date: "2026-01-02", balance: "1000" },
      { date: "2026-01-03", balance: "1000" },
    ]);
    expect(result.closingBalance).toBe("1000");
  });

  it("includes events on both range boundaries and excludes outside events", () => {
    const events = [
      cashEvent({ id: "before", amount: "999", expectedDate: "2025-12-31" }),
      cashEvent({ id: "start", amount: "100", expectedDate: "2026-01-01" }),
      cashEvent({ id: "end", amount: "-50", expectedDate: "2026-01-03" }),
      cashEvent({ id: "after", amount: "999", expectedDate: "2026-01-04" }),
    ];

    const result = runForecast(input({ events }));

    expect(result.timeline.map((point) => point.balance)).toEqual(["1100", "1100", "1050"]);
    expect(result.closingBalance).toBe("1050");
  });

  it("excludes completed and cancelled events", () => {
    const events = [
      cashEvent({ amount: "100", status: "pending" }),
      cashEvent({ amount: "500", status: "completed" }),
      cashEvent({ amount: "700", status: "cancelled" }),
    ];

    expect(runForecast(input({ events })).closingBalance).toBe("1100");
  });

  it("aggregates same-day events deterministically by createdAt, expense priority and id", () => {
    const first = cashEvent({
      id: "b",
      amount: "0.2",
      createdAt: "2025-12-01T00:00:00.000Z",
    });
    const second = cashEvent({
      id: "a",
      amount: "0.1",
      createdAt: "2025-12-01T00:00:00.000Z",
    });

    const forward = runForecast(input({ openingBalance: "0", events: [first, second] }));
    const reverse = runForecast(input({ openingBalance: "0", events: [second, first] }));

    expect(forward).toEqual(reverse);
    expect(forward.timeline[1].balance).toBe("0.3");
  });

  it("applies expenses before income when creation timestamps match", () => {
    const precisionBoundary = "10000000000000000000000000000000000000000";
    const income = cashEvent({
      id: "a-income",
      amount: "1",
      createdAt: "2025-12-01T00:00:00.000Z",
    });
    const expense = cashEvent({
      id: "z-expense",
      amount: "-1",
      createdAt: "2025-12-01T00:00:00.000Z",
    });

    const result = runForecast(input({ openingBalance: precisionBoundary, events: [income, expense] }));

    expect(result.closingBalance).toBe(precisionBoundary);
  });

  it("does not mutate the event array or its elements", () => {
    const event = cashEvent();
    const events = Object.freeze([event]);
    const snapshot = JSON.stringify(events);

    runForecast(input({ events }));

    expect(JSON.stringify(events)).toBe(snapshot);
    expect(events[0]).toBe(event);
  });

  it("rejects an eligible event that has not been converted to the reporting currency", () => {
    const events = [cashEvent({ currency: "USD" })];

    expect(() => runForecast(input({ events }))).toThrow(CurrencyMismatchError);
  });
});

describe("runForecast minimum balance", () => {
  it("includes opening balance and returns startDate when it remains the minimum", () => {
    const result = runForecast(input({ events: [cashEvent({ amount: "100" })] }));

    expect(result.minimumBalance).toBe("1000");
    expect(result.minimumDate).toBe("2026-01-01");
  });

  it("returns the first date when the same minimum is reached repeatedly", () => {
    const events = [
      cashEvent({ amount: "-200", expectedDate: "2026-01-01" }),
      cashEvent({ amount: "100", expectedDate: "2026-01-02" }),
      cashEvent({ amount: "-100", expectedDate: "2026-01-03" }),
    ];
    const result = runForecast(input({ events }));

    expect(result.minimumBalance).toBe("800");
    expect(result.minimumDate).toBe("2026-01-01");
  });
});

describe("runForecast threshold and runway", () => {
  it("calculates the threshold without rounding", () => {
    const result = runForecast(input({ openingBalance: "123.456" }));

    expect(DANGER_THRESHOLD_PERCENT).toBe("50");
    expect(result.dangerThresholdAmount).toBe("61.728");
    expect(result.dangerThresholdPercent).toBe("50");
  });

  it("does not trigger when balance equals the threshold and triggers when strictly below", () => {
    const events = [
      cashEvent({ amount: "-500", expectedDate: "2026-01-01" }),
      cashEvent({ amount: "-1", expectedDate: "2026-01-02" }),
    ];
    const result = runForecast(input({ events }));

    expect(result.dangerThresholdAmount).toBe("500");
    expect(result.firstDangerDate).toBe("2026-01-02");
    expect(result.runwayDays).toBe(1);
  });

  it("returns runway zero when the first end-of-day balance is below threshold", () => {
    const result = runForecast(
      input({ events: [cashEvent({ amount: "-501", expectedDate: "2026-01-01" })] }),
    );

    expect(result.firstDangerDate).toBe("2026-01-01");
    expect(result.runwayDays).toBe(0);
  });

  it("returns null when the threshold is never breached", () => {
    const result = runForecast(input());

    expect(result.firstDangerDate).toBeNull();
    expect(result.runwayDays).toBeNull();
  });
});

describe("runForecast validation and immutability", () => {
  it.each([
    { startDate: "2026-02-30" },
    { endDate: "2026/01/03" },
    { startDate: "2026-01-04", endDate: "2026-01-03" },
  ])("rejects invalid date range %#", (overrides) => {
    expect(() => runForecast(input(overrides))).toThrow(ForecastInputError);
  });

  it("rejects a negative opening balance for percentage-based thresholds", () => {
    expect(() => runForecast(input({ openingBalance: "-1" }))).toThrow(ForecastInputError);
  });

  it("freezes the result, timeline and individual points", () => {
    const result = runForecast(input());

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.timeline)).toBe(true);
    expect(result.timeline.every(Object.isFrozen)).toBe(true);
  });
});
