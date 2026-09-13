import { describe, it, expect } from "vitest";
import { credentialsSchema, portfolioNameSchema } from "@/lib/validation";
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
