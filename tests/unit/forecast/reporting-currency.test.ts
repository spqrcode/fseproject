import { describe, it, expect } from "vitest";
import {
  appliedFactor,
  convertForecastInput,
  fxRate,
  FxRateError,
  parseCashEvent,
  runForecast,
  type ForecastInput,
} from "@/lib/forecast";

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  const currency = overrides.currency ?? "USD";
  const event = (id: string, amount: string, expectedDate: string) =>
    parseCashEvent({ id, amount, currency, expectedDate, createdAt: "2026-09-01T00:00:00.000Z", status: "pending" });
  return {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    openingBalance: "1000",
    dangerThreshold: null,
    currency,
    events: [event("inv", "500", "2026-10-10"), event("rent", "-300.50", "2026-10-20")],
    ...overrides,
  };
}
// 1 EUR = 1.25 USD, so one USD is 0.8 EUR.
const EUR_USD = fxRate("EUR", "USD", "1.25");

describe("convertForecastInput", () => {
  it("returns the input untouched when it is already in the reporting currency", () => {
    const original = input({ currency: "EUR" });
    expect(convertForecastInput(original, "EUR", null)).toBe(original);
  });

  it("converts the opening balance and every event with the one rate, in either direction of the pair", () => {
    // The rate is quoted EUR/USD; the input is in USD, so amounts are divided by 1.25.
    const converted = convertForecastInput(input(), "EUR", EUR_USD);
    expect(converted.currency).toBe("EUR");
    expect(converted.openingBalance).toBe("800");
    expect(converted.events.map((event) => [event.id, event.amount, event.currency])).toEqual([
      ["inv", "400", "EUR"],
      ["rent", "-240.4", "EUR"],
    ]);
    // The other direction multiplies.
    const back = convertForecastInput(input({ currency: "EUR" }), "USD", EUR_USD);
    expect(back.openingBalance).toBe("1250");
    expect(back.events[0].amount).toBe("625");
  });

  it("does not round: a converted amount keeps its exact decimal value", () => {
    const converted = convertForecastInput(input({ openingBalance: "100" }), "EUR", fxRate("EUR", "USD", "1.3"));
    // 100 / 1.3 with the engine's 40 significant digits: far more than the two decimals of a display amount.
    expect(converted.openingBalance.startsWith("76.923076923076923076923076923076")).toBe(true);
    expect(converted.openingBalance.split(".")[1].length).toBeGreaterThan(30);
  });

  it("passes the workspace threshold through: it is already an amount in the reporting currency", () => {
    const converted = convertForecastInput(input({ dangerThreshold: "250.00" }), "EUR", EUR_USD);
    expect(converted.dangerThreshold).toBe("250.00");
    // And a missing threshold stays missing, so the engine's 50% default is of the converted opening balance.
    const defaulted = runForecast(convertForecastInput(input(), "EUR", EUR_USD));
    expect(defaulted.dangerThresholdPercent).toBe("50");
    expect(defaulted.dangerThresholdAmount).toBe("400");
  });

  it("makes the converted forecast the base forecast scaled by the rate, not a mix of rates", () => {
    const base = runForecast(input());
    const converted = runForecast(convertForecastInput(input(), "EUR", EUR_USD));
    expect(converted.currency).toBe("EUR");
    for (const [index, point] of base.timeline.entries()) {
      expect(Number(converted.timeline[index].balance)).toBeCloseTo(Number(point.balance) / 1.25, 10);
    }
    expect(converted.minimumDate).toBe(base.minimumDate);
    // (1000 + 500 - 300.50) / 1.25
    expect(converted.closingBalance).toBe("959.6");
  });

  it("applies the workspace threshold in the reporting currency, which is what changes the warning", () => {
    // A threshold of 900 EUR: the converted opening balance of 800 EUR is below it from the first day. Applied
    // unconverted to USD it would not be (1000 > 900), which was the bug in the account-currency forecast.
    const unconverted = runForecast(input({ dangerThreshold: "900" }));
    const converted = runForecast(convertForecastInput(input({ dangerThreshold: "900" }), "EUR", EUR_USD));
    expect(unconverted.firstDangerDate).toBeNull();
    expect(converted.firstDangerDate).toBe("2026-10-01");
  });

  it("refuses to convert without a rate, and with a rate for a different pair", () => {
    expect(() => convertForecastInput(input(), "EUR", null)).toThrow(FxRateError);
    expect(() => convertForecastInput(input(), "SGD", EUR_USD)).toThrow(FxRateError);
  });

  it("does not change the input or its events", () => {
    const original = input();
    const snapshot = JSON.stringify(original);
    const converted = convertForecastInput(original, "EUR", EUR_USD);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(converted.events).not.toBe(original.events);
    expect(Object.isFrozen(converted)).toBe(true);
    expect(Object.isFrozen(converted.events)).toBe(true);
  });

  it("keeps an empty event list and a negative opening balance", () => {
    const converted = convertForecastInput(input({ events: [], openingBalance: "-125" }), "EUR", EUR_USD);
    expect(converted.events).toEqual([]);
    expect(converted.openingBalance).toBe("-100");
  });
});

describe("appliedFactor", () => {
  it("gives what one unit of the source currency is worth, whichever way the rate is quoted", () => {
    expect(appliedFactor(EUR_USD, "EUR")).toBe("1.25");
    expect(appliedFactor(EUR_USD, "USD")).toBe("0.8");
  });
});
