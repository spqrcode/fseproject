import { describe, expect, it } from "vitest";
import {
  addMoney,
  compareMoney,
  CurrencyMismatchError,
  money,
  parseCurrency,
  roundMoney,
  subtractMoney,
  UnsupportedCurrencyError,
  type Currency,
} from "@/lib/forecast";

describe("forecast money", () => {
  it("adds and subtracts without binary floating-point errors", () => {
    expect(addMoney(money("0.1", "EUR"), money("0.2", "EUR")))
      .toEqual({ amount: "0.3", currency: "EUR" });
    expect(subtractMoney(money("10000000000000000.01", "SGD"), money("0.02", "SGD")))
      .toEqual({ amount: "9999999999999999.99", currency: "SGD" });
  });

  it("supports zero and negative amounts", () => {
    expect(addMoney(money("-5.25", "USD"), money("5.25", "USD")))
      .toEqual({ amount: "0", currency: "USD" });
    expect(compareMoney(money("-0.01", "USD"), money("0", "USD"))).toBe(-1);
  });

  it("does not allow different currencies to be combined silently", () => {
    expect(() => addMoney(money("1", "EUR"), money("1", "USD")))
      .toThrow(CurrencyMismatchError);
    expect(() => compareMoney(money("1", "SGD"), money("1", "USD")))
      .toThrow("without an exchange rate");
  });

  it.each(["GBP", "eur", "", null, 123])("rejects unsupported runtime currency %j", value => {
    expect(() => parseCurrency(value)).toThrow(UnsupportedCurrencyError);
    expect(() => money("1", value as Currency)).toThrow(UnsupportedCurrencyError);
  });

  it("rounds half-even only when explicitly requested", () => {
    expect(money("1.245", "USD").amount).toBe("1.245");
    expect(roundMoney(money("1.245", "USD"))).toEqual({ amount: "1.24", currency: "USD" });
    expect(roundMoney(money("1.255", "USD"))).toEqual({ amount: "1.26", currency: "USD" });
    expect(roundMoney(money("-1.245", "USD"))).toEqual({ amount: "-1.24", currency: "USD" });
    expect(roundMoney(money("-1.255", "USD"))).toEqual({ amount: "-1.26", currency: "USD" });
    expect(roundMoney(money("-0.004", "USD"))).toEqual({ amount: "0", currency: "USD" });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid decimal-place count %j",
    places => expect(() => roundMoney(money("1", "EUR"), places)).toThrow(RangeError),
  );

  it("returns immutable values and does not mutate its operands", () => {
    const left = money("10", "SGD");
    const right = money("2.5", "SGD");
    const result = subtractMoney(left, right);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(left).toEqual({ amount: "10", currency: "SGD" });
    expect(right).toEqual({ amount: "2.5", currency: "SGD" });
  });
});
