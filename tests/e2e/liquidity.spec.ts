import AxeBuilder from "@axe-core/playwright";
import { test, expect, signUpAndIn, noSidewaysScroll, type Account } from "./fixtures";

// The Cash events page is separate work, so accounts and events are inserted directly; the page under test
// only reads them through the session-checked forecast input.
function utcDay(offset: number) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}
async function createWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/workspace");
  await page.getByLabel("Workspace name").fill("Acme GmbH");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /saved|created/i })).toBeVisible();
}
async function seedAccount(account: Account, name: string, currency: string, opening: string) {
  const { rows } = await account.db.query(`INSERT INTO cash_accounts(workspace_id, name, currency, opening_balance)
    SELECT w.id, $2, $3, $4 FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.email = $1 RETURNING id, workspace_id`,
  [account.email, name, currency, opening]);
  return rows[0] as { id: string; workspace_id: string };
}
async function seedEvent(account: Account, target: { id: string; workspace_id: string }, description: string, amount: string, date: string) {
  await account.db.query(`INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date, status)
    VALUES ($1,$2,$3,$4,$5,'expected')`, [target.workspace_id, target.id, description, amount, date]);
}

test("without a cash account the overview says so and shows no figures", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await createWorkspace(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Add a cash account to see your forecast." })).toBeVisible();
  await expect(page.locator(".metrics")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("€");
});

test("shows the real forecast, the first breach and overdue events, and changes horizon and account", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await createWorkspace(page);
  const operating = await seedAccount(account, "Operating", "EUR", "1000.00");
  await seedEvent(account, operating, "Late supplier", "-300.00", utcDay(-5));
  await seedEvent(account, operating, "Rent", "-500.00", utcDay(3));
  await seedEvent(account, operating, "Invoice 42", "250.00", utcDay(7));
  const singapore = await seedAccount(account, "Singapore", "SGD", "80.00");

  await page.goto("/dashboard");
  const forecast = page.getByRole("region", { name: "Next 90 days" });
  await expect(forecast).toBeVisible();
  const metric = (label: string) => forecast.locator(".metrics > div").filter({ has: page.getByText(label, { exact: true }) });
  await expect(metric("Balance today")).toContainText("€1,000.00");
  await expect(metric("Lowest balance")).toContainText("€200.00");
  await expect(metric("Runway")).toContainText("3 days");
  await expect(forecast.getByRole("note").first()).toContainText("falls below the danger threshold of €500.00");
  await expect(forecast.getByRole("listitem").filter({ hasText: "Late supplier" })).toContainText("-€300.00");
  await forecast.getByText(/Daily balances \(90 days\)/).click();
  await expect(forecast.getByRole("table").getByRole("row")).toHaveCount(91);

  await page.getByLabel("Horizon").selectOption("30");
  await page.getByRole("button", { name: "Show forecast", exact: true }).click();
  await expect(page).toHaveURL(/days=30/);
  await expect(page.getByRole("region", { name: "Next 30 days" })).toBeVisible();

  await page.getByLabel("Account").selectOption(singapore.id);
  await page.getByRole("button", { name: "Show forecast", exact: true }).click();
  const sgd = page.getByRole("region", { name: "Next 30 days" });
  await expect(sgd).toContainText("Singapore · SGD");
  await expect(sgd.getByRole("note").filter({ hasText: "not converted yet" })).toBeVisible();
  await expect(sgd.locator(".metrics")).toContainText("SGD 80.00");
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
});

test("an account id from someone else falls back to the caller's own account", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await createWorkspace(page);
  await seedAccount(account, "Operating", "EUR", "10.00");
  await page.goto(`/dashboard?account=${crypto.randomUUID()}&days=9999`);
  await expect(page.getByRole("region", { name: "Next 90 days" })).toContainText("Operating · EUR");
});

test("the forecast fits a phone screen", async ({ page, account }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signUpAndIn(page, account);
  await createWorkspace(page);
  await seedAccount(account, "Operating", "EUR", "1000.00");
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Next 90 days" })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the forecast with a breach and overdue events passes WCAG 2.2 AA checks in ${scheme} mode`, async ({ page, account }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signUpAndIn(page, account);
    await createWorkspace(page);
    const operating = await seedAccount(account, "Operating", "EUR", "1000.00");
    await seedEvent(account, operating, "Late supplier", "-300.00", utcDay(-5));
    await seedEvent(account, operating, "Rent", "-500.00", utcDay(3));
    await seedAccount(account, "Singapore", "SGD", "80.00");
    await page.goto("/dashboard");
    await page.getByText(/Daily balances/).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}
