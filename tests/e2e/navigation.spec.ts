import { test as base, expect, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

type Account = { email: string; password: string; db: Pool };
const test = base.extend<{ account: Account }>({
  account: async ({}, provide) => {
    const email = `e2e-nav-${randomUUID()}@example.com`;
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
async function signUpAndIn(page: Page, account: Account) {
  await page.goto("/register");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("account is ready");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
const sections = [
  { label: "Overview", path: "/dashboard", heading: "Overview" },
  { label: "Forecast", path: "/forecast", heading: "Forecast" },
  { label: "Scenarios", path: "/scenarios", heading: "Scenarios" },
  { label: "Portfolio", path: "/portfolio", heading: "Your portfolio" },
  { label: "Settings", path: "/settings", heading: "Settings" },
];

test("every private section sends signed-out visitors to sign in", async ({ page }) => {
  for (const section of sections) {
    await page.goto(section.path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await expect(page).toHaveTitle("Sign in · FinTwin Global");
});

test("main navigation reaches every section and marks only the current one", async ({ page, account }) => {
  await signUpAndIn(page, account);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const section of sections) {
    await nav.getByRole("link", { name: section.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${section.path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(section.heading);
    await expect(page).toHaveTitle(`${section.label} · FinTwin Global`);
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: section.label, exact: true })).toHaveAttribute("aria-current", "page");
  }
});

test("sections that are not connected yet say so instead of showing figures", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await expect(page.getByRole("link", { name: "Create your portfolio", exact: true })).toBeVisible();
  for (const path of ["/forecast", "/scenarios"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 2 })).toContainText("not connected yet");
    await expect(page.locator("main")).not.toContainText(/[€$£¥]\s?\d/);
  }
});

test("the reporting currency is saved, survives reload and reaches the other pages", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await expect(page.getByText("Figures will be reported in Euro (EUR).")).toBeVisible();
  await page.goto("/settings");
  const select = page.getByLabel("Reporting currency");
  await expect(select).toHaveValue("EUR");
  await expect(page.getByText("Example: €1,234.56")).toBeVisible();
  await select.selectOption("USD");
  await expect(page.getByText("Example: US$1,234.56")).toBeVisible();
  await page.getByRole("button", { name: "Save currency", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Reporting currency saved.");
  // Regression check: React's automatic form reset used to put the select back on EUR after a successful save.
  await expect(select).toHaveValue("USD");
  await expect(page.getByText("Example: US$1,234.56")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Reporting currency")).toHaveValue("USD");
  await page.goto("/dashboard");
  await expect(page.getByText("Figures will be reported in US dollar (USD).")).toBeVisible();
  await page.goto("/forecast");
  await expect(page.locator("main")).toContainText("US dollar (USD)");
});

test("an expired session cannot change the currency from a page that is already open", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await page.goto("/settings");
  await account.db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [account.email]);
  await page.getByLabel("Reporting currency").selectOption("GBP");
  await page.getByRole("button", { name: "Save currency", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const stored = await account.db.query("SELECT reporting_currency FROM users WHERE email=$1", [account.email]);
  expect(stored.rows[0].reporting_currency).toBe("EUR");
});

test("keyboard users can skip straight to the page content", async ({ page, account }) => {
  await signUpAndIn(page, account);
  // A fresh load, because after a client-side redirect the browser keeps its focus starting point mid-page.
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("phone-sized screens never scroll sideways", async ({ page, account }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await signUpAndIn(page, account);
  for (const section of sections) {
    await page.goto(section.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(section.heading);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, section.path).toBeLessThanOrEqual(0);
  }
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings", exact: true })).toBeAttached();
});
