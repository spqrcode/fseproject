import { describe, it, expect } from "vitest";
import { toEngineStatus } from "@/lib/forecast-input";
import { forecastRangeSchema } from "@/lib/validation";
import { CASH_EVENT_STATUSES } from "@/lib/cash-event-status";

describe("toEngineStatus", () => {
  it("maps expected to pending, received and paid to completed, and leaves cancelled out", () => {
    expect(toEngineStatus("expected")).toBe("pending");
    expect(toEngineStatus("received")).toBe("completed");
    expect(toEngineStatus("paid")).toBe("completed");
    expect(toEngineStatus("cancelled")).toBeNull();
  });
  it("covers every database status", () => {
    for (const status of CASH_EVENT_STATUSES) expect(["pending", "completed", null]).toContain(toEngineStatus(status));
  });
});

describe("forecast range", () => {
  const range = (startDate: string, endDate: string) => forecastRangeSchema.safeParse({ startDate, endDate });
  it("accepts one day and at most 366 days", () => {
    expect(range("2026-10-01", "2026-10-01").success).toBe(true);
    expect(range("2026-10-01", "2027-10-02").success).toBe(true);   // 366 days
    expect(range("2028-01-01", "2028-12-31").success).toBe(true);   // 365 days in a leap year
  });
  it("rejects more than 366 days, a start after the end, and dates outside 2000-2100", () => {
    expect(range("2026-10-01", "2027-10-03").success).toBe(false);  // 367 days
    expect(range("2026-10-02", "2026-10-01").success).toBe(false);
    expect(range("1999-12-31", "2000-01-02").success).toBe(false);
    expect(range("2100-12-30", "2101-01-01").success).toBe(false);
    expect(range("2026-02-30", "2026-03-05").success).toBe(false);
    expect(range("2026-10-01", "01.11.2026").success).toBe(false);
  });
});
