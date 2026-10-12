import { describe, expect, it } from "vitest";
import {
  runForecast,
  toForecastInput,
  type StoredForecastInput,
} from "@/lib/forecast";

function storedInput(
  overrides: Partial<StoredForecastInput> = {},
): StoredForecastInput {
  return {
    account: { id: "account-1", name: "Operating", currency: "EUR" },
    startDate: "2026-10-11",
    endDate: "2026-10-12",
    startingBalance: "1000.00",
    dangerThreshold: "400.00",
    events: [
      {
        id: "event-1",
        description: "Overdue invoice",
        amount: "250.00",
        expectedDate: "2026-10-11",
        originalDate: "2026-10-01",
        overdue: true,
        createdAt: "2026-09-01T09:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("toForecastInput", () => {
  it("maps store fields and supplies the account currency and pending status", () => {
    const result = toForecastInput(storedInput());

    expect(result).toEqual({
      startDate: "2026-10-11",
      endDate: "2026-10-12",
      openingBalance: "1000.00",
      dangerThreshold: "400.00",
      currency: "EUR",
      events: [
        {
          id: "event-1",
          amount: "250.00",
          currency: "EUR",
          expectedDate: "2026-10-11",
          createdAt: "2026-09-01T09:00:00.000Z",
          status: "pending",
        },
      ],
    });
  });

  it("does not expose account or presentation-only event metadata to the engine", () => {
    const result = toForecastInput(storedInput());
    const event = result.events[0] as unknown as Record<string, unknown>;
    const input = result as unknown as Record<string, unknown>;

    expect(input).not.toHaveProperty("account");
    expect(input).not.toHaveProperty("startingBalance");
    expect(event).not.toHaveProperty("description");
    expect(event).not.toHaveProperty("originalDate");
    expect(event).not.toHaveProperty("overdue");
  });

  it("does not mutate the store result", () => {
    const source = storedInput();
    const snapshot = JSON.stringify(source);

    const result = toForecastInput(source);

    expect(JSON.stringify(source)).toBe(snapshot);
    expect(result.events[0]).not.toBe(source.events[0]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(result.events.every(Object.isFrozen)).toBe(true);
  });

  it("produces input that can be passed directly to runForecast", () => {
    const result = runForecast(toForecastInput(storedInput()));

    expect(result.timeline).toEqual([
      { date: "2026-10-11", balance: "1250" },
      { date: "2026-10-12", balance: "1250" },
    ]);
    expect(result.openingBalance).toBe("1000");
    expect(result.closingBalance).toBe("1250");
    expect(result.currency).toBe("EUR");
  });

  it("preserves a null threshold so the engine applies its default", () => {
    const result = runForecast(
      toForecastInput(storedInput({ dangerThreshold: null, events: [] })),
    );

    expect(result.dangerThresholdPercent).toBe("50");
    expect(result.dangerThresholdAmount).toBe("500");
  });
});
