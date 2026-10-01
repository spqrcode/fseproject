import { test as base, expect, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

type Account = { email: string; password: string; db: Pool };
const test = base.extend<{ account: Account }>({
  account: async ({}, provide) => {
    const email = `e2e-${randomUUID()}@example.com`;
    const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    try { await provide({ email, password: `test-only-${randomUUID()}`, db }); }
    finally {
      await db.query("DELETE FROM users WHERE email=$1", [email]);
      await db.query("DELETE FROM auth_limits WHERE key=$1", [`account:${createHash("sha256").update(email).digest("hex")}`]);
      await db.end();
    }
  },
});
async function register(page: Page, account: Account) {
  await page.goto("/register");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("account is ready");
}
async function login(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("US-01: registration, login, existing portfolio persistence, logout and replay rejection", async ({ page, browser, account }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await register(page, account);
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill("a wrong long password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Check your email and password." })).toHaveText("Check your email and password.");
  await login(page, account);
  const cookie = (await page.context().cookies()).find(c => c.name === "portfolio_session");
  expect(cookie).toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie?.secure).toBe(true);
  expect(cookie?.domain).toBe("localhost");
  expect(cookie?.path).toBe("/");
  expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(86000);
  expect(cookie!.expires - Date.now() / 1000).toBeLessThanOrEqual(86400);
  await page.getByRole("link", { name: "Create your portfolio", exact: true }).click();
  await page.getByLabel("Portfolio name").fill("Long-term savings");
  await page.getByRole("button", { name: "Create portfolio", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Portfolio saved.");
  await page.reload();
  await expect(page.getByLabel("Portfolio name")).toHaveValue("Long-term savings");
  const anonymous = await browser.newContext();
  try {
    const other = await anonymous.newPage();
    await other.goto("/portfolio");
    await expect(other).toHaveURL(/\/login$/);
  } finally { await anonymous.close(); }
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.context().cookies()).find(c => c.name === "portfolio_session")).toBeUndefined();
  await page.context().addCookies([cookie!]);
  await page.goto("/portfolio");
  await expect(page).toHaveURL(/\/login$/);
});

test("US-01: server expiry overrides a still-valid browser cookie", async ({ page, account }) => {
  await register(page, account);
  await login(page, account);
  await account.db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [account.email]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/portfolio");
  await expect(page).toHaveURL(/\/login$/);
});

test("US-01: duplicate registration preserves the password and gives the same response", async ({ page, account }) => {
  await register(page, account);
  const original = await page.getByRole("status").textContent();
  await register(page, { ...account, password: "another long test passphrase" });
  expect(await page.getByRole("status").textContent()).toBe(original);
  await login(page, account);
});

test("US-01: expired session cannot submit a form already open in the browser", async ({ page, account }) => {
  await register(page, account);
  await login(page, account);
  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await page.getByLabel("Portfolio name").fill("Must not be saved");
  await account.db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [account.email]);
  await page.getByRole("button", { name: "Create portfolio", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const result = await account.db.query("SELECT p.id FROM portfolios p JOIN users u ON u.id=p.user_id WHERE u.email=$1", [account.email]);
  expect(result.rowCount).toBe(0);
});
