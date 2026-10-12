import { describe, it, expect } from "vitest";
import { DEFAULT_HORIZON, chartGeometry, firstParam, forecastWindow, parseHorizon } from "@/lib/liquidity-overview";
import { MAX_FORECAST_DAYS } from "@/lib/forecast";

describe("horizon", () => {
  it("accepts exactly the offered values", () => {
    expect(parseHorizon("30")).toBe(30);
    expect(parseHorizon("365")).toBe(365);
    expect(parseHorizon(["180", "30"])).toBe(180);
  });
  it("falls back to the default for anything a person could type into the URL", () => {
    for (const value of [undefined, "", "0", "-30", "366", "90.0", " 30", "30days", "1e2", "999999999999"]) {
      expect(parseHorizon(value), String(value)).toBe(DEFAULT_HORIZON);
    }
  });
});

describe("forecast window", () => {
  it("starts on today's UTC date and counts both ends", () => {
    // 23:30 in New York on 11 October is already 12 October in UTC.
    expect(forecastWindow(new Date("2026-10-12T03:30:00Z"), 30)).toEqual({ startDate: "2026-10-12", endDate: "2026-11-10" });
    expect(forecastWindow(new Date("2026-10-12T23:59:59Z"), 90)).toEqual({ startDate: "2026-10-12", endDate: "2027-01-09" });
  });
  it("keeps the longest horizon inside the engine's limit, across a leap day", () => {
    const { startDate, endDate } = forecastWindow(new Date("2027-06-01T12:00:00Z"), 365);
    expect(endDate).toBe("2028-05-30");
    const dates = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
    expect(dates).toBe(365);
    expect(dates).toBeLessThanOrEqual(MAX_FORECAST_DAYS);
  });
  it("reads the first of repeated query parameters", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("a")).toBe("a");
    expect(firstParam(undefined)).toBeUndefined();
  });
});

const base = { dangerThresholdAmount: "500", minimumBalance: "1000", minimumDate: "2026-10-01", firstDangerDate: null };
const size = { width: 100, height: 120, padding: 10 };

describe("chart geometry", () => {
  it("draws a step line from the first to the last date, highest balance at the top", () => {
    const chart = chartGeometry({ ...base, minimumBalance: "500", timeline: [
      { date: "2026-10-01", balance: "1000" }, { date: "2026-10-02", balance: "500" }, { date: "2026-10-03", balance: "1000" },
    ] }, size);
    expect(chart.path).toBe("M0,10 H50 V110 H100 V10");
    expect(chart.thresholdY).toBe(110);
    expect(chart.zeroY).toBeNull();
  });
  it("marks the lowest point at the engine's minimum, even when it is below every end-of-day balance", () => {
    // Opening 1000, an expense of 800 and income of 800 on the first day: the end-of-day series never shows 200.
    const chart = chartGeometry({ ...base, dangerThresholdAmount: "500", minimumBalance: "200", minimumDate: "2026-10-01", timeline: [
      { date: "2026-10-01", balance: "1000" }, { date: "2026-10-02", balance: "1000" },
    ] }, size);
    expect(chart.bottom).toBe(200);
    expect(chart.minimum).toEqual({ x: 0, y: 110 });
  });
  it("marks the first breach and draws a zero line when the balance turns negative", () => {
    const chart = chartGeometry({ ...base, minimumBalance: "-100", minimumDate: "2026-10-03", firstDangerDate: "2026-10-02", timeline: [
      { date: "2026-10-01", balance: "900" }, { date: "2026-10-02", balance: "400" }, { date: "2026-10-03", balance: "-100" },
    ] }, size);
    expect(chart.dangerX).toBe(50);
    expect(chart.minimum).toEqual({ x: 100, y: 110 });
    expect(chart.zeroY).toBe(100);
  });
  it("draws a single-date or flat forecast as a level line instead of dividing by zero", () => {
    const single = chartGeometry({ ...base, dangerThresholdAmount: "1000", timeline: [{ date: "2026-10-01", balance: "1000" }] }, size);
    expect(single.path).toBe("M0,60 H100 V60");
    expect(single.minimum).toEqual({ x: 0, y: 60 });
  });
  it("refuses values it cannot place", () => {
    expect(() => chartGeometry({ ...base, timeline: [] })).toThrow(RangeError);
    expect(() => chartGeometry({ ...base, timeline: [{ date: "2026-10-01", balance: "abc" }] })).toThrow(RangeError);
    expect(() => chartGeometry({ ...base, timeline: [{ date: "1 Oct", balance: "1" }] })).toThrow(RangeError);
  });
});
