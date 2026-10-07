import { describe, expect, it } from "vitest";
import {
  convertMoney,
  fxRate,
  FxRateError,
  money,
  roundMoney,
  UnsupportedCurrencyError,
  type Currency,
  type FxRate,
} from "@/lib/forecast";

describe("EUR/USD/SGD conversion", () => {
  it("uses an explicitly directed quote", () => {
    const eurUsd = fxRate("EUR", "USD", "1.125");
    expect(convertMoney(money("80", "EUR"), "USD", eurUsd))
      .toEqual({ amount: "90", currency: "USD" });
  });

  it("uses the reciprocal when converting against the quote direction", () => {
    const usdSgd = fxRate("USD", "SGD", "1.35");
    expect(convertMoney(money("135", "SGD"), "USD", usdSgd))
      .toEqual({ amount: "100", currency: "USD" });
  });

  it("handles zero and negative amounts without changing the rate direction", () => {
    const eurUsd = fxRate("EUR", "USD", "1.25");
    expect(convertMoney(money("0", "EUR"), "USD", eurUsd))
      .toEqual({ amount: "0", currency: "USD" });
    expect(convertMoney(money("-8", "EUR"), "USD", eurUsd))
      .toEqual({ amount: "-10", currency: "USD" });
  });

  it("keeps conversion precision until explicit rounding", () => {
    const eurSgd = fxRate("EUR", "SGD", "3");
    const converted = convertMoney(money("1", "SGD"), "EUR", eurSgd);
    expect(converted.amount).toBe("0.3333333333333333333333333333333333333333");
    expect(roundMoney(converted)).toEqual({ amount: "0.33", currency: "EUR" });
  });

  it("preserves a high-precision direct conversion", () => {
    const rate = fxRate("USD", "SGD", "1.23456789123456789");
    expect(convertMoney(money("3", "USD"), "SGD", rate))
      .toEqual({ amount: "3.70370367370370367", currency: "SGD" });
  });

  it("returns new immutable values without mutating the amount or rate", () => {
    const value = money("10", "USD");
    const rate = fxRate("USD", "SGD", "1.3");
    const converted = convertMoney(value, "SGD", rate);
    expect(Object.isFrozen(rate)).toBe(true);
    expect(Object.isFrozen(converted)).toBe(true);
    expect(value).toEqual({ amount: "10", currency: "USD" });
    expect(rate).toEqual({ base: "USD", quote: "SGD", rate: "1.3" });
  });

  it("rejects invalid, missing, and unrelated rates", () => {
    expect(() => fxRate("EUR", "USD", "0")).toThrow(FxRateError);
    expect(() => fxRate("EUR", "USD", "-1")).toThrow(FxRateError);
    expect(() => fxRate("EUR", "EUR", "1")).toThrow(FxRateError);
    expect(() => convertMoney(money("1", "EUR"), "SGD"))
      .toThrow("Missing FX rate");
    expect(() => convertMoney(money("1", "EUR"), "SGD", fxRate("EUR", "USD", "1.1")))
      .toThrow("cannot convert");
    expect(() => convertMoney(money("1", "EUR"), "USD", { base: "EUR", quote: "USD", rate: "0" }))
      .toThrow("greater than zero");
  });

  it("revalidates currencies in runtime values", () => {
    expect(() => fxRate("GBP" as Currency, "USD", "1")).toThrow(UnsupportedCurrencyError);
    const forged = { base: "GBP", quote: "USD", rate: "1" } as unknown as FxRate;
    expect(() => convertMoney(money("1", "USD"), "EUR", forged))
      .toThrow(UnsupportedCurrencyError);
  });
});
