import { describe, it, expect } from "vitest";
import { formatRate, UNAVAILABLE } from "@/lib/format";

describe("exchange rates", () => {
  it("shows four decimals, like the ECB reference rates", () => {
    expect(formatRate("1.0856")).toBe("1.0856");
    expect(formatRate("1.4127")).toBe("1.4127");
    expect(formatRate("2")).toBe("2.0000");
  });
  it("rounds the long results of cross and reciprocal rates for display only", () => {
    // USD/SGD and SGD/EUR from EUR/USD 1.0856 and EUR/SGD 1.4127, as the rate service returns them.
    expect(formatRate("1.30130803242446573323507737656595431098")).toBe("1.3013");
    expect(formatRate("0.7078643731860975437106250442415233241311")).toBe("0.7079");
  });
  it("rounds half to even, the same rule as amounts and the forecast engine", () => {
    expect(formatRate("1.23455")).toBe("1.2346");
    expect(formatRate("1.23445")).toBe("1.2344");
  });
  it("shows a missing rate as unavailable rather than a number", () => {
    expect(formatRate(null)).toBe(UNAVAILABLE);
    expect(formatRate(undefined)).toBe(UNAVAILABLE);
  });
  it.each(["0", "0.0000", "-1.0856", "", "abc", "1e3", "1,0856", "NaN"])("refuses %j instead of printing a rate", value => {
    expect(() => formatRate(value)).toThrow(RangeError);
  });
});
