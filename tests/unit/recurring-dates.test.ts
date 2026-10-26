import { describe, it, expect } from "vitest";
import { MAX_OCCURRENCES, REPEAT_STEP_MONTHS, recurringDates, recurringDatesUntil } from "@/lib/recurring-dates";
import { repeatDatesSchema, repeatEndSchema, repeatFrequencySchema } from "@/lib/validation";

const { monthly, quarterly, annually } = REPEAT_STEP_MONTHS;

describe("repeat dates by number of occurrences", () => {
  it("keeps the same day each month and starts with the entered date", () => {
    expect(recurringDates("2026-10-15", monthly, 3)).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });
  it("moves a missing day to the month's last day and goes back to the original day afterwards", () => {
    expect(recurringDates("2027-01-31", monthly, 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(recurringDates("2026-08-30", monthly, 3)).toEqual(["2026-08-30", "2026-09-30", "2026-10-30"]);
  });
  it("uses 29 February in a leap year", () => {
    expect(recurringDates("2028-01-31", monthly, 2)).toEqual(["2028-01-31", "2028-02-29"]);
  });
  it("crosses the year end", () => {
    expect(recurringDates("2026-11-30", monthly, 4)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28"]);
  });
  it("steps three months for a quarterly repeat", () => {
    expect(recurringDates("2026-11-30", quarterly, 4)).toEqual(["2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30"]);
  });
  it("steps a year for an annual repeat and keeps 29 February only in leap years", () => {
    expect(recurringDates("2028-02-29", annually, 5)).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });
  it("produces distinct, ascending dates", () => {
    const dates = recurringDates("2026-10-31", monthly, MAX_OCCURRENCES);
    expect(new Set(dates).size).toBe(MAX_OCCURRENCES);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("repeat dates up to an end date", () => {
  it("includes the end date itself and nothing after it", () => {
    expect(recurringDatesUntil("2026-10-15", monthly, "2026-12-15")).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
    expect(recurringDatesUntil("2026-10-15", monthly, "2026-12-14")).toEqual(["2026-10-15", "2026-11-15"]);
  });
  it("gives just the first date when the end date comes before the second occurrence", () => {
    expect(recurringDatesUntil("2026-10-15", quarterly, "2026-12-31")).toEqual(["2026-10-15"]);
  });
  it("stops one date past the limit, so the caller can refuse an end date that is too far away", () => {
    expect(recurringDatesUntil("2026-10-15", monthly, "2100-12-31")).toHaveLength(MAX_OCCURRENCES + 1);
    expect(recurringDatesUntil("2026-10-15", annually, "2036-10-15")).toHaveLength(11);
  });
});

describe("repeat validation", () => {
  it.each(["once", "monthly", "quarterly", "annually"])("accepts the frequency %s", value => {
    expect(repeatFrequencySchema.safeParse(value).success).toBe(true);
  });
  it.each(["weekly", "daily", "", "Monthly", 1, null])("rejects the frequency %s", value => {
    expect(repeatFrequencySchema.safeParse(value).success).toBe(false);
  });
  it.each([["2", 2], ["12", 12], ["60", 60]])("accepts %s occurrences", (value, count) => {
    expect(repeatEndSchema.parse({ mode: "count", count: value })).toEqual({ mode: "count", count });
  });
  it.each(["0", "1", "61", "100", "-2", "2.5", "", "twelve", null])("rejects %s occurrences", value => {
    expect(repeatEndSchema.safeParse({ mode: "count", count: value }).success).toBe(false);
  });
  it("accepts a real end date and rejects a missing mode, an invalid date and an open end", () => {
    expect(repeatEndSchema.parse({ mode: "date", until: "2027-06-30", count: null })).toEqual({ mode: "date", until: "2027-06-30" });
    expect(repeatEndSchema.safeParse({ mode: "date", until: "2027-02-30" }).success).toBe(false);
    expect(repeatEndSchema.safeParse({ mode: null, count: "12" }).success).toBe(false);
    expect(repeatEndSchema.safeParse({ mode: "never" }).success).toBe(false);
  });
  it("accepts 1 to 60 real dates and rejects anything else", () => {
    expect(repeatDatesSchema.safeParse(recurringDates("2026-10-15", monthly, 60)).success).toBe(true);
    expect(repeatDatesSchema.safeParse([]).success).toBe(false);
    expect(repeatDatesSchema.safeParse(recurringDates("2026-10-15", monthly, 61)).success).toBe(false);
    expect(repeatDatesSchema.safeParse(["2026-02-30"]).success).toBe(false);
    expect(repeatDatesSchema.safeParse(recurringDates("2100-11-15", monthly, 3)).success).toBe(false);
  });
});
