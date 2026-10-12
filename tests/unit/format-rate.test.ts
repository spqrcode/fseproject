import { describe, it, expect } from "vitest";
import { formatRate, UNAVAILABLE } from "@/lib/format";

describe("exchange rates", () => {
  it("shows four decimals like ECB publishes them", () => {
    expect(formatRate("1.0856")).toBe("1.0856");
    expect(formatRate("1.30130803242446573323507737656595431098")).toBe("1.3013");
    expect(formatRate("0.7078643731860975437106250442415233241311")).toBe("0.7079");
    expect(formatRate("1.4127")).toBe("1.4127");
  });
  it("pads to four decimals so a column of rates lines up", () => {
    expect(formatRate("1.5")).toBe("1.5000");
    expect(formatRate("2")).toBe("2.0000");
  });
  it("rounds half to even, like the engine and formatMoney", () => {
    expect(formatRate("1.00005")).toBe("1.0000");
    expect(formatRate("1.00015")).toBe("1.0002");
    expect(formatRate("1.00025")).toBe("1.0002");
  });
  it("does not group digits and keeps a very small rate visible", () => {
    expect(formatRate("12345.6789")).toBe("12345.6789");
    expect(formatRate("0.00001234567")).toBe("0.00001235");
    expect(formatRate("0.00001234567")).not.toBe("0.0000");
  });
  it("reports a missing rate as unavailable and refuses text that is not a decimal", () => {
    expect(formatRate(null)).toBe(UNAVAILABLE);
    expect(formatRate(undefined)).toBe(UNAVAILABLE);
    expect(() => formatRate("1e5")).toThrow(RangeError);
    expect(() => formatRate("abc")).toThrow(RangeError);
  });
});
