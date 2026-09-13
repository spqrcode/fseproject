import { test as base, expect, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

type Account = { email: string; password: string };
const password = "a browser test passphrase";

const test = base.extend<{ db: Pool }>({
  // Named "provide" rather than Playwright's usual "use": the React hooks lint
  // rule treats a bare use(...) call as a hook.
  db: async ({}, provide) => {
    const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    try { await provide(db); } finally { await db.end(); }
  },
});

const created: string[] = [];
function account(): Account {
  const email = `holdings-${randomUUID()}@example.com`;
  created.push(email);
  return { email, password };
}

test.afterAll(async () => {
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  await db.query("DELETE FROM users WHERE email = ANY($1::text[])", [created]);
  await db.query("DELETE FROM auth_limits WHERE key = ANY($1::text[])",
    [created.map(email => `account:${createHash("sha256").update(email).digest("hex")}`)]);
  await db.end();
});

async function signUp(page: Page, user: Account, portfolio: string) {
  await page.goto("/register");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("account is ready");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/portfolio");
  await page.getByLabel("Portfolio name").fill(portfolio);
  await page.getByRole("button", { name: "Create portfolio", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("Portfolio saved.");
}

// Next.js keeps a permanent empty role="alert" route announcer in the page, so
// every assertion below excludes it rather than weakening the role selector.
function errors(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

async function add(page: Page, symbol: string, quantity: string, price: string) {
  await page.getByLabel("Ticker", { exact: true }).fill(symbol);
  await page.getByLabel("Quantity", { exact: true }).fill(quantity);
  await page.getByLabel("Average purchase price", { exact: true }).fill(price);
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
}

test("US-03: add, persist, edit and remove a holding", async ({ page }) => {
  await signUp(page, account(), "Long-term savings");
  await expect(page.getByText("No holdings yet. Add your first position above.")).toBeVisible();

  await add(page, "aapl", "10", "185.40");
  await expect(page.getByRole("status").filter({ hasText: "AAPL added." })).toBeVisible();
  await expect(page.getByLabel("Ticker for AAPL")).toHaveValue("AAPL");
  await expect(page.getByLabel("Quantity for AAPL")).toHaveValue("10.00000000");
  await expect(page.getByLabel("Average purchase price for AAPL")).toHaveValue("185.40000000");

  await page.reload();
  await expect(page.getByLabel("Ticker for AAPL")).toHaveValue("AAPL");

  await page.getByLabel("Quantity for AAPL").fill("12.5");
  await page.getByRole("button", { name: "Save AAPL", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "AAPL updated." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Quantity for AAPL")).toHaveValue("12.50000000");

  // The row carries its own messages, so a successful removal is shown by the
  // row disappearing rather than by a notice that unmounts with it.
  await page.getByRole("button", { name: "Remove AAPL", exact: true }).click();
  await expect(page.getByLabel("Ticker for AAPL")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No holdings yet. Add your first position above.")).toBeVisible();
});

test("US-03: rejects a duplicate ticker and invalid amounts without changing stored data", async ({ page }) => {
  await signUp(page, account(), "Checks");
  await add(page, "MSFT", "3", "300");
  await expect(page.getByLabel("Quantity for MSFT")).toHaveValue("3.00000000");

  await add(page, "msft", "1", "10");
  await expect(errors(page).first()).toContainText("already in your portfolio");

  const rejected = [["0", "greater than zero"], ["-2", "plain number"], ["NaN", "plain number"], ["1e3", "plain number"]] as const;
  for (const [quantity, message] of rejected) {
    await add(page, "TSLA", quantity, "100");
    await expect(errors(page).first()).toContainText(message);
  }
  await add(page, "not a ticker", "1", "100");
  await expect(errors(page).first()).toContainText("ticker");

  await page.reload();
  await expect(page.getByLabel("Quantity for MSFT")).toHaveValue("3.00000000");
  await expect(page.getByLabel("Ticker for TSLA")).toHaveCount(0);
});

test("US-07: a second user never sees or reaches the first user's holdings", async ({ page, browser, db }) => {
  const owner = account();
  await signUp(page, owner, "Owner portfolio");
  await add(page, "NVDA", "4", "500");
  await expect(page.getByLabel("Ticker for NVDA")).toBeVisible();
  const stored = await db.query(
    "SELECT h.id FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id JOIN users u ON u.id = p.user_id WHERE u.email = $1",
    [owner.email]);
  const holdingId: string = stored.rows[0].id;

  const second = await browser.newContext();
  try {
    const intruder = await second.newPage();
    await signUp(intruder, account(), "Intruder portfolio");
    await expect(intruder.getByText("No holdings yet. Add your first position above.")).toBeVisible();
    await expect(intruder.getByLabel("Ticker for NVDA")).toHaveCount(0);
    await expect(intruder.locator("body")).not.toContainText("NVDA");

    // Submit the owner's holding id through the intruder's own edit form.
    await intruder.getByLabel("Portfolio name").fill("Intruder portfolio");
    await add(intruder, "IBM", "1", "100");
    await expect(intruder.getByLabel("Ticker for IBM")).toBeVisible();
    await intruder.locator('input[name="id"]').first().evaluate((input, id) => {
      (input as HTMLInputElement).value = id;
    }, holdingId);
    await intruder.getByLabel("Quantity for IBM").fill("999");
    await intruder.getByRole("button", { name: "Save IBM", exact: true }).click();
    await expect(errors(intruder).first()).toContainText("no longer available");
  } finally {
    await second.close();
  }

  await page.reload();
  await expect(page.getByLabel("Quantity for NVDA")).toHaveValue("4.00000000");
  const unchanged = await db.query("SELECT quantity FROM holdings WHERE id = $1", [holdingId]);
  expect(unchanged.rows[0].quantity).toBe("4.00000000");
});

test("US-03: an expired session cannot submit a holdings form that is already open", async ({ page, db }) => {
  const user = account();
  await signUp(page, user, "Expiring");
  await add(page, "AMZN", "2", "150");
  await expect(page.getByLabel("Ticker for AMZN")).toBeVisible();
  await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [user.email]);
  await page.getByRole("button", { name: "Remove AMZN", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const still = await db.query(
    "SELECT 1 FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id JOIN users u ON u.id = p.user_id WHERE u.email = $1", [user.email]);
  expect(still.rowCount).toBe(1);
});
