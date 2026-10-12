import AxeBuilder from "@axe-core/playwright";
import { test, expect, signUpAndIn, type Account } from "./fixtures";

async function createWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/workspace");
  await page.getByLabel("Workspace name").fill("Demo workspace");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace saved.");
}

test("a user can create an account and manage an expected expense", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await createWorkspace(page);
  await page.goto("/cash-events");

  await page.getByLabel("Account name").fill("Operating account");
  await page.getByLabel("Currency").selectOption("USD");
  await page.getByLabel("Opening balance").fill("2500.00");
  await page.getByRole("button", { name: "Add cash account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash account added." })).toBeVisible();
  await expect(page.getByText("Operating account", { exact: true })).toBeVisible();
  await expect(page.getByText("US$2,500.00", { exact: true })).toBeVisible();

  await page.getByLabel("Description").fill("Office rent");
  await page.getByLabel("Signed amount").fill("0");
  await page.getByLabel("Expected date").fill("2026-10-20");
  await page.getByRole("button", { name: "Add cash event", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The amount cannot be zero." })).toBeVisible();

  await page.getByLabel("Signed amount").fill("-1250.50");
  await page.getByRole("button", { name: "Add cash event", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash event added." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Office rent" })).toBeVisible();
  await expect(page.getByText("-US$1,250.50", { exact: true })).toBeVisible();
  await expect(page.getByText("expected", { exact: true })).toBeVisible();

  await page.getByText("Edit", { exact: true }).click();
  await page.getByLabel("Description").last().fill("Office rent and utilities");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash event updated." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Office rent and utilities" })).toBeVisible();

  await page.getByRole("button", { name: /^Mark paid: Office rent and utilities$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash event marked paid." })).toBeVisible();
  await expect(page.getByText("paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mark paid/ })).toHaveCount(0);
  // Dates read like the rest of the application, not as an ISO string.
  await expect(page.getByText("20 Oct 2026", { exact: true })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("1 event", { exact: true })).toBeVisible();
});

test("income uses received and an expected event can be cancelled", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await createWorkspace(page);
  await page.goto("/cash-events");
  await page.getByLabel("Account name").fill("Receivables");
  await page.getByRole("button", { name: "Add cash account", exact: true }).click();

  await page.getByLabel("Description").fill("Customer invoice");
  await page.getByLabel("Signed amount").fill("900");
  await page.getByLabel("Expected date").fill("2026-11-02");
  await page.getByRole("button", { name: "Add cash event", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Mark received: Customer invoice$/ })).toBeVisible();

  await page.getByRole("button", { name: /^Cancel event: Customer invoice$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash event cancelled." })).toBeVisible();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Edit", { exact: true })).toHaveCount(0);
});

// Accounts and events are inserted directly so that these tests do not repeat the form flow above.
async function seed(account: Account, events: { description: string; amount: string; date: string }[]) {
  const target = (await account.db.query(`INSERT INTO cash_accounts(workspace_id, name, currency, opening_balance)
    SELECT w.id, 'Operating', 'SGD', 1000 FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.email = $1
    RETURNING id, workspace_id`, [account.email])).rows[0] as { id: string; workspace_id: string };
  for (const event of events) {
    await account.db.query(`INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date)
      VALUES ($1,$2,$3,$4,$5)`, [target.workspace_id, target.id, event.description, event.amount, event.date]);
  }
}

test("deleting an event takes a second step and leaves the event alone until it is confirmed", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await createWorkspace(page);
  await seed(account, [{ description: "Office rent", amount: "-1250.50", date: "2026-10-20" }, { description: "Customer invoice", amount: "900", date: "2026-11-02" }]);
  await page.goto("/cash-events");

  // Two events, two Delete controls: the accessible names say which event each one belongs to.
  await expect(page.getByText("Delete", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Delete: Office rent", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Delete: Customer invoice", { exact: true })).toBeVisible();

  // Opening the confirmation changes nothing.
  await page.getByLabel("Delete: Office rent", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Office rent" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 3, name: "Office rent" })).toBeVisible();

  await page.getByLabel("Delete: Office rent", { exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently: Office rent", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash event deleted." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Office rent" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Customer invoice" })).toBeVisible();
});

test("an action on an event that has already changed says so instead of doing nothing", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await createWorkspace(page);
  await seed(account, [{ description: "Customer invoice", amount: "900", date: "2026-11-02" }]);
  await page.goto("/cash-events");
  await expect(page.getByRole("button", { name: /^Cancel event: Customer invoice$/ })).toBeVisible();

  // The event is settled elsewhere (another tab or session) while this page is still open.
  await account.db.query("UPDATE cash_events SET status = 'received' WHERE description = 'Customer invoice'");
  await page.getByRole("button", { name: /^Cancel event: Customer invoice$/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "nothing was changed" })).toBeVisible();
  await expect(page.getByText("received", { exact: true })).toBeVisible();
  await expect(page.getByText("cancelled", { exact: true })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the filled Cash events page passes WCAG 2.2 AA checks in ${scheme} mode`, async ({ page, account }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signUpAndIn(page, account);
    await createWorkspace(page);
    await seed(account, [{ description: "Office rent", amount: "-1250.50", date: "2026-10-20" }, { description: "Customer invoice", amount: "900", date: "2026-11-02" }]);
    await account.db.query("INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date, status) SELECT workspace_id, id, 'Old invoice', 50, '2026-09-01', 'cancelled' FROM cash_accounts ca WHERE ca.workspace_id IN (SELECT w.id FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.email = $1)", [account.email]);
    await page.goto("/cash-events");
    // Cover the open states too: the delete confirmation and an open editor.
    await page.getByLabel("Delete: Office rent", { exact: true }).click();
    await page.getByLabel("Edit: Customer invoice", { exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}
