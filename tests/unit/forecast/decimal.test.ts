import { describe, expect, it } from "vitest";
import { decimalString, parseDecimal } from "@/lib/forecast/decimal";
import { DecimalInputError } from "@/lib/forecast";

describe("forecast decimal input", () => {
  it.each(["NaN", "Infinity", "-Infinity", "1e3", "+1", "01", " 1", "1 ", "", "1,25"])(
    "rejects non-plain decimal input %j",
    value => expect(() => parseDecimal(value)).toThrow(DecimalInputError),
  );

  it("normalizes zero and negative zero without an exponent", () => {
    expect(decimalString(parseDecimal("0.000"))).toBe("0");
    expect(decimalString(parseDecimal("-0.000"))).toBe("0");
  });

  it("serializes very large and very small inputs without exponent notation", () => {
    const large = "123456789012345678901234567890.123456789";
    const small = `0.${"0".repeat(100)}1`;
    expect(decimalString(parseDecimal(large))).toBe(large);
    expect(decimalString(parseDecimal(small))).toBe(small);
  });
});
