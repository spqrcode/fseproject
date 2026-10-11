import { describe, expect, it } from "vitest";
import {
  CashEventValidationError,
  parseCashEvent,
  type RawCashEvent,
} from "@/lib/forecast/cash-event";

function rawEvent(overrides: Partial<RawCashEvent> = {}): RawCashEvent {
  return {
    id: "event-1",
    amount: "1250.5000",
    currency: "EUR",
    expectedDate: "2026-10-15",
    createdAt: "2026-10-05T09:30:00.000Z",
    status: "expected",
    ...overrides,
  };
}

describe("parseCashEvent", () => {
  it("normalizes a valid signed amount and freezes the result", () => {
    const event = parseCashEvent(rawEvent());

    expect(event.amount).toBe("1250.5");
    expect(event.currency).toBe("EUR");
    expect(Object.isFrozen(event)).toBe(true);
  });

  it.each(["100", "-100"])("accepts a non-zero signed amount %s", (amount) => {
    expect(parseCashEvent(rawEvent({ amount })).amount).toBe(amount);
  });

  it.each(["0", "-0", "0.00"])("rejects zero amount %s", (amount) => {
    expect(() => parseCashEvent(rawEvent({ amount }))).toThrow(CashEventValidationError);
  });

  it.each(["1e3", "01", " 1", "1 ", "NaN"])("rejects malformed amount %s", (amount) => {
    expect(() => parseCashEvent(rawEvent({ amount }))).toThrow(CashEventValidationError);
  });

  it.each(["EUR", "USD", "SGD"])("accepts supported currency %s", (currency) => {
    expect(parseCashEvent(rawEvent({ currency })).currency).toBe(currency);
  });

  it.each(["GBP", "eur", ""])("rejects unsupported currency %s", (currency) => {
    expect(() => parseCashEvent(rawEvent({ currency }))).toThrow(CashEventValidationError);
  });

  it.each(["expected", "received", "paid", "cancelled"])("accepts status %s", (status) => {
    expect(parseCashEvent(rawEvent({ status })).status).toBe(status);
  });

  it.each(["active", "invalid", ""])("rejects unsupported status %s", (status) => {
    expect(() => parseCashEvent(rawEvent({ status }))).toThrow(CashEventValidationError);
  });

  it.each(["2025-02-29", "2025-02-30", "2026-04-31", "2026/10/15", "0000-01-01"])(
    "rejects invalid calendar date %s",
    (expectedDate) => {
      expect(() => parseCashEvent(rawEvent({ expectedDate }))).toThrow(CashEventValidationError);
    },
  );

  it("accepts February 29 in a leap year", () => {
    expect(parseCashEvent(rawEvent({ expectedDate: "2024-02-29" })).expectedDate).toBe(
      "2024-02-29",
    );
  });

  it.each([
    "2026-10-05T09:30:00",
    "2026-10-05T11:30:00+02:00",
    "2026-02-30T09:30:00Z",
    "not-a-timestamp",
  ])("rejects non-UTC or invalid createdAt %s", (createdAt) => {
    expect(() => parseCashEvent(rawEvent({ createdAt }))).toThrow(CashEventValidationError);
  });

  it.each([
    ["2026-10-05T09:30:00Z", "2026-10-05T09:30:00.000Z"],
    ["2026-10-05T09:30:00.001Z", "2026-10-05T09:30:00.001Z"],
    ["2026-10-05T09:30:00.1Z", "2026-10-05T09:30:00.100Z"],
    ["2026-10-05T09:30:00.10Z", "2026-10-05T09:30:00.100Z"],
  ])("normalizes UTC timestamp %s to %s", (createdAt, expected) => {
    expect(parseCashEvent(rawEvent({ createdAt })).createdAt).toBe(expected);
  });

  it.each(["", " event-1"])("rejects invalid id %s", (id) => {
    expect(() => parseCashEvent(rawEvent({ id }))).toThrow(CashEventValidationError);
  });
});
