import { test, expect, signUpAndIn } from "./fixtures";

test("a delayed invoice stays hypothetical and the scenario validates FX preview input", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await page.goto("/workspace");
  await page.getByLabel("Workspace name").fill("Scenario workspace");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace saved.");

  await page.goto("/cash-events");
  await page.getByLabel("Account name").fill("Operating cash");
  await page.getByRole("button", { name: "Add cash account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash account added." })).toBeVisible();
  await page.getByLabel("Description").fill("Customer invoice");
  await page.getByLabel("Signed amount").fill("900");
  await page.getByLabel("Expected date").fill("2026-11-02");
  await page.getByRole("button", { name: "Add cash event", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash event added." })).toBeVisible();

  await page.goto("/scenarios");
  await page.getByLabel("Scenario name").fill("Late customer payment");
  await page.getByRole("button", { name: "Create scenario", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Scenario created." })).toBeVisible();
  await page.getByLabel("New expected date").fill("2026-11-16");
  await page.getByRole("button", { name: "Delay invoice in scenario" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invoice delayed in this scenario." })).toBeVisible();
  await expect(page.getByRole("table", { name: "Invoice delay comparison" })).toContainText("2026-11-02");
  await expect(page.getByRole("table", { name: "Invoice delay comparison" })).toContainText("2026-11-16");

  await page.getByLabel("Quote currency").selectOption("EUR");
  await page.getByRole("button", { name: "Preview shock" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose two different currencies" })).toHaveText("Choose two different currencies and a plain percentage.");

  await page.goto("/cash-events");
  await expect(page.getByRole("heading", { level: 3, name: "Customer invoice" })).toBeVisible();
  await expect(page.getByText("2026-11-02", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-11-16", { exact: true })).toHaveCount(0);
});
