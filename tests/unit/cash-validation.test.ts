import { describe, it, expect } from "vitest";
import { balanceSchema, cashEventSchema, dangerThresholdSchema, eventAmountSchema, isoDateSchema, uuidSchema } from "@/lib/validation";

describe("cash amounts", () => {
  it.each(["1", "-1", "0.5", "1250.50", "-80", "999999999999999999", "-999999999999999999.99"])("accepts %s", value => {
    expect(eventAmountSchema.safeParse(value).success).toBe(true);
  });
  it.each(["", " 1", "1 ", "+1", "1e3", "1E3", "NaN", "Infinity", "-Infinity", ".5", "1.", "1.234", "007", "1,000", "--1", "1000000000000000000", 5, null])("rejects %s", value => {
    expect(eventAmountSchema.safeParse(value).success).toBe(false);
  });
  it.each(["0", "-0", "0.0", "0.00", "-0.00"])("rejects the zero event amount %s but allows it as a balance", value => {
    expect(eventAmountSchema.safeParse(value).success).toBe(false);
    expect(balanceSchema.safeParse(value).success).toBe(true);
  });
  it("allows null only for the danger threshold", () => {
    expect(dangerThresholdSchema.safeParse(null).success).toBe(true);
    expect(dangerThresholdSchema.safeParse("NaN").success).toBe(false);
    expect(balanceSchema.safeParse(null).success).toBe(false);
  });
});

describe("cash dates and ids", () => {
  it.each(["2000-01-01", "2026-02-28", "2028-02-29", "2100-12-31"])("accepts %s", value => expect(isoDateSchema.safeParse(value).success).toBe(true));
  it.each(["1999-12-31", "2101-01-01", "2026-02-30", "2027-02-29", "2026-13-01", "2026-1-1", "2026-10-01T00:00:00Z", "infinity", "", "0000-01-01"])("rejects %s", value => {
    expect(isoDateSchema.safeParse(value).success).toBe(false);
  });
  it("accepts a UUID and rejects anything else", () => {
    expect(uuidSchema.safeParse("3b241101-e2bb-4255-8caf-4136c566a962").success).toBe(true);
    for (const value of ["", "not-a-uuid", "3b241101-e2bb-4255-8caf-4136c566a96", "' OR 1=1 --", 7]) expect(uuidSchema.safeParse(value).success).toBe(false);
  });
  it("trims descriptions and strips unknown keys such as an owner id", () => {
    const parsed = cashEventSchema.parse({ description: "  Rent  ", amount: "-10", expectedDate: "2026-10-01", workspaceId: "x", userId: "y" });
    expect(parsed).toEqual({ description: "Rent", amount: "-10", expectedDate: "2026-10-01" });
    expect(cashEventSchema.safeParse({ description: "   ", amount: "-10", expectedDate: "2026-10-01" }).success).toBe(false);
    expect(cashEventSchema.safeParse({ description: "a".repeat(201), amount: "-10", expectedDate: "2026-10-01" }).success).toBe(false);
  });
});
