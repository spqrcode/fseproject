import { test as base, expect, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

// Shared by the product experience specs: a unique throwaway account per test, removed afterwards.
export type Account = { email: string; password: string; db: Pool };
export const test = base.extend<{ account: Account }>({
  account: async ({}, provide) => {
    const email = `e2e-px-${randomUUID()}@example.com`;
    const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    try { await provide({ email, password: `test-only-${randomUUID()}`, db }); }
    finally {
      await db.query("DELETE FROM users WHERE email=$1", [email]);
      // Matches every throttle key prefix for this address, whichever naming the rate limiter uses.
      await db.query("DELETE FROM auth_limits WHERE split_part(key, ':', 2) = $1", [createHash("sha256").update(email).digest("hex")]);
      await db.end();
    }
  },
});
export { expect };

export async function signUp(page: Page, account: Account) {
  await page.goto("/register");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("account is ready");
}
export async function signIn(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
export async function signUpAndIn(page: Page, account: Account) {
  await signUp(page, account);
  await signIn(page, account);
}
export async function noSidewaysScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
