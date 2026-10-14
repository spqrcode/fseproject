import { describe, it, expect } from "vitest";
import { forecastRangeSchema } from "@/lib/validation";

describe("forecast range", () => {
  const range = (startDate: string, endDate: string) => forecastRangeSchema.safeParse({ startDate, endDate });
  it("accepts one day and at most 366 dates counting both ends", () => {
    expect(range("2026-10-01", "2026-10-01").success).toBe(true);
    expect(range("2026-10-01", "2027-10-01").success).toBe(true);   // 366 dates
    expect(range("2028-01-01", "2028-12-31").success).toBe(true);   // 366 dates, a leap year
    expect(range("2027-01-01", "2027-12-31").success).toBe(true);   // 365 dates, an ordinary year
  });
  it("rejects more than 366 dates, a start after the end, and dates outside 2000-2100", () => {
    expect(range("2026-10-01", "2027-10-02").success).toBe(false);  // 367 dates
    expect(range("2028-01-01", "2029-01-01").success).toBe(false);  // 367 dates
    expect(range("2026-10-02", "2026-10-01").success).toBe(false);
    expect(range("1999-12-31", "2000-01-02").success).toBe(false);
    expect(range("2100-12-30", "2101-01-01").success).toBe(false);
    expect(range("2026-02-30", "2026-03-05").success).toBe(false);
    expect(range("2026-10-01", "01.11.2026").success).toBe(false);
  });
});
