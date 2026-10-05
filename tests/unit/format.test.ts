import { describe, it, expect } from "vitest";
import { formatMoney, formatPercent, formatTimestamp, UNAVAILABLE } from "@/lib/format";
import { REPORTING_CURRENCIES, DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { reportingCurrencySchema } from "@/lib/validation";

describe("money", () => {
  it("formats each reporting currency with its own symbol and minor units", () => {
    expect(formatMoney("1234.5", "EUR")).toBe("€1,234.50");
    expect(formatMoney("1234.5", "USD")).toBe("US$1,234.50");
    // ICU separates the SGD code from the amount with a non-breaking space, so it never wraps onto two lines.
    expect(formatMoney("1234.5", "SGD")).toBe("SGD\u00a01,234.50");
  });
  it("uses the minor units of any ISO currency it is given, not only the reporting ones", () => {
    expect(formatMoney("1234.5", "JPY")).toBe("JP¥1,235");
  });
  it("keeps every digit of large decimal strings instead of going through floating point", () => {
    expect(formatMoney("12345678901234567.89", "EUR")).toBe("€12,345,678,901,234,567.89");
    expect(String(12345678901234567.89)).not.toContain("67.89");
  });
  it("rounds half away from zero only at display time", () => {
    expect(formatMoney("0.005", "EUR")).toBe("€0.01");
    expect(formatMoney("-0.005", "EUR")).toBe("-€0.01");
    expect(formatMoney("0.0049", "EUR")).toBe("€0.00");
  });
  it("never shows a negative zero", () => {
    expect(formatMoney("-0.001", "EUR")).toBe("€0.00");
    expect(formatMoney("-0.001", "EUR", { signed: true })).toBe("€0.00");
  });
  it("can show the sign of a change", () => {
    expect(formatMoney("25", "USD", { signed: true })).toBe("+US$25.00");
    expect(formatMoney("-25", "USD", { signed: true })).toBe("-US$25.00");
    expect(formatMoney("0", "USD", { signed: true })).toBe("US$0.00");
  });
  it("shows a missing amount as unavailable rather than zero", () => {
    expect(formatMoney(null, "EUR")).toBe(UNAVAILABLE);
    expect(formatMoney(undefined, "EUR")).toBe(UNAVAILABLE);
  });
  it.each(["", "abc", "NaN", "Infinity", "1e3", "1,000", " 1", "1.", ".5", "+1", "1".repeat(41)])("refuses %j instead of printing NaN or a guessed value", value => {
    expect(() => formatMoney(value, "EUR")).toThrow(RangeError);
  });
  it.each(["eur", "EURO", "", "E1R"])("refuses the currency code %j", code => {
    expect(() => formatMoney("1", code)).toThrow(RangeError);
  });
});

describe("percent", () => {
  it("formats ratios with at most two decimals", () => {
    expect(formatPercent("0.123456")).toBe("12.35%");
    expect(formatPercent("1")).toBe("100%");
    expect(formatPercent("-0.05", { signed: true })).toBe("-5%");
    expect(formatPercent("0.05", { signed: true })).toBe("+5%");
    expect(formatPercent("-0.00001")).toBe("0%");
  });
  it("shows an undefined ratio as unavailable", () => {
    expect(formatPercent(null)).toBe(UNAVAILABLE);
    expect(() => formatPercent("NaN")).toThrow(RangeError);
  });
});

describe("timestamps", () => {
  it("labels times as UTC regardless of the machine time zone", () => {
    expect(formatTimestamp(new Date("2026-10-01T14:05:00Z"))).toBe("1 Oct 2026, 14:05 UTC");
    expect(formatTimestamp("2026-10-01T23:30:00+02:00")).toBe("1 Oct 2026, 21:30 UTC");
  });
  it("refuses invalid dates and shows missing ones as unavailable", () => {
    expect(() => formatTimestamp("not a date")).toThrow(RangeError);
    expect(formatTimestamp(null)).toBe(UNAVAILABLE);
  });
});

describe("reporting currency", () => {
  it("accepts only the listed codes", () => {
    for (const code of REPORTING_CURRENCIES) expect(reportingCurrencySchema.parse(code)).toBe(code);
    for (const value of ["usd", "SEK", "GBP", "JPY", "EUR ", "", null, 1, ["EUR"]]) expect(reportingCurrencySchema.safeParse(value).success).toBe(false);
  });
  it("defaults to a listed currency and labels it for people", () => {
    expect(REPORTING_CURRENCIES).toContain(DEFAULT_REPORTING_CURRENCY);
    expect(currencyLabel("SGD")).toBe("Singapore dollar (SGD)");
  });
});
