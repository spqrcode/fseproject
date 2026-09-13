import { describe, it, expect } from "vitest";
import { credentialsSchema, portfolioNameSchema, holdingSchema, holdingIdSchema } from "@/lib/validation";
import { hashPassword, verifyPassword } from "@/lib/password";
import { tokenHash, validToken } from "@/lib/session-store";
describe("credentials", () => {
  it("normalizes email without changing the password", () => {
    const password = "  a long passphrase  ";
    expect(credentialsSchema.parse({ email: " Alice@Example.com ", password })).toEqual({ email: "alice@example.com", password });
  });
  it.each(["", "short", "x".repeat(129)])("rejects invalid password length", password => {
    expect(credentialsSchema.safeParse({ email: "a@example.com", password }).success).toBe(false);
  });
  it("rejects malformed email and non-string values", () => {
    expect(credentialsSchema.safeParse({ email: "bad", password: "a long passphrase" }).success).toBe(false);
    expect(portfolioNameSchema.safeParse(4).success).toBe(false);
    expect(portfolioNameSchema.safeParse(" ").success).toBe(false);
    expect(portfolioNameSchema.safeParse("a".repeat(81)).success).toBe(false);
  });
});
describe("password storage", () => {
  it("uses unique salts and verifies only the correct password", async () => {
    const password = "an example passphrase";
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toEqual(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("a different passphrase", first)).toBe(false);
  });
  it("rejects corrupt hashes", async () => { expect(await verifyPassword("password", "bad$hash")).toBe(false); });
});
it("only accepts full random session tokens and hashes them deterministically", () => {
  expect(validToken("a".repeat(64))).toBe(true);
  expect(validToken("x".repeat(64))).toBe(false);
  expect(validToken("a".repeat(63))).toBe(false);
  expect(tokenHash("a".repeat(64))).toHaveLength(64);
  expect(tokenHash("a".repeat(64))).not.toEqual("a".repeat(64));
});

describe("holding input", () => {
  const valid = { symbol: "aapl", quantity: "10", averageBuyPrice: "185.40" };
  it("normalizes the ticker and keeps amounts as exact strings", () => {
    expect(holdingSchema.parse({ ...valid, symbol: "  brk.b " })).toEqual({ symbol: "BRK.B", quantity: "10", averageBuyPrice: "185.40" });
    // Kept as text so no precision is lost before the valuation increment.
    expect(holdingSchema.parse({ ...valid, quantity: "0.00000001" }).quantity).toBe("0.00000001");
  });
  it.each(["", "1AAPL", "AAPL.TOOLONG", "AA PL", "ELEVENCHARS", "AAPL;--", "<script>"])("rejects ticker %s", symbol => {
    expect(holdingSchema.safeParse({ ...valid, symbol }).success).toBe(false);
  });
  it.each(["NaN", "Infinity", "-Infinity", "1e5", "-1", "+1", "0", "0.0", "abc", "", " ", "1.123456789", "1234567890123", "1,5"])
    ("rejects quantity %s as non-finite, non-positive or out of range", quantity => {
      expect(holdingSchema.safeParse({ ...valid, quantity }).success).toBe(false);
    });
  it("rejects a purchase price above the documented maximum but accepts the maximum", () => {
    expect(holdingSchema.safeParse({ ...valid, averageBuyPrice: "1000000001" }).success).toBe(false);
    expect(holdingSchema.safeParse({ ...valid, averageBuyPrice: "1000000000" }).success).toBe(true);
  });
  it("accepts the largest value the numeric(20, 8) column can hold", () => {
    expect(holdingSchema.safeParse({ ...valid, quantity: "999999999999.99999999" }).success).toBe(true);
  });
  it("rejects identifiers that are not UUIDs", () => {
    expect(holdingIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(holdingIdSchema.safeParse("00000000-0000-4000-8000-000000000000").success).toBe(true);
  });
});
