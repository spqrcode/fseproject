import { test, expect, signUpAndIn } from "./fixtures";

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

  await page.getByRole("button", { name: "Mark paid", exact: true }).click();
  await expect(page.getByText("paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark paid", exact: true })).toHaveCount(0);

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
  await expect(page.getByRole("button", { name: "Mark received", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Edit", { exact: true })).toHaveCount(0);
});
