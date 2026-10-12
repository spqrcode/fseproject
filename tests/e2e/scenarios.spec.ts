import AxeBuilder from "@axe-core/playwright";
import { test, expect, signUpAndIn, noSidewaysScroll } from "./fixtures";

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
  // A real table with scoped headers, and dates written like the rest of the application.
  const comparison = page.getByRole("table", { name: "Invoice delay comparison" });
  await expect(comparison.getByRole("columnheader", { name: "Base date" })).toBeVisible();
  await expect(comparison.getByRole("rowheader", { name: /Customer invoice/ })).toBeVisible();
  await expect(comparison).toContainText("2 Nov 2026");
  await expect(comparison).toContainText("16 Nov 2026");

  await page.getByLabel("Quote currency").selectOption("EUR");
  await page.getByRole("button", { name: "Preview shock" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose two different currencies" })).toHaveText("Choose two different currencies and a plain percentage.");

  await page.goto("/cash-events");
  await expect(page.getByRole("heading", { level: 3, name: "Customer invoice" })).toBeVisible();
  // The Cash events page shows the date as ISO text or formatted, depending on whether the formatting change
  // has reached this branch; either way the base event keeps its original date and never the delayed one.
  await expect(page.getByText(/^(2026-11-02|2 Nov 2026)$/)).toBeVisible();
  await expect(page.getByText(/^(2026-11-16|16 Nov 2026)$/)).toHaveCount(0);
});

// ECB snapshots are global reference data: the test seeds a fresh, clearly marked pair so the preview needs no
// network, and removes it (and the scenario that references it) afterwards.
test("rates are rounded for reading, the exact value is kept, and a saved shock says what it refers to", async ({ page, account }) => {
  const effective = "2099-01-01";
  await account.db.query(`INSERT INTO fx_snapshots (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
    VALUES ('ecb','EUR','USD',1.0856,$1,now()), ('ecb','EUR','SGD',1.4127,$1,now())`, [effective]);
  try {
    await signUpAndIn(page, account);
    await page.goto("/workspace");
    await page.getByLabel("Workspace name").fill("Rates workspace");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Workspace saved.");
    await page.goto("/scenarios");
    await page.getByLabel("Scenario name").fill("Weaker euro");
    await page.getByRole("button", { name: "Create scenario", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Scenario created." })).toBeVisible();

    // A cross rate has a long exact value; the page shows four decimals and keeps the exact one.
    await page.getByLabel("Base currency").selectOption("USD");
    await page.getByLabel("Quote currency").selectOption("SGD");
    await page.getByRole("button", { name: "Preview shock" }).click();
    const crossRate = page.locator("data").filter({ hasText: "1 USD =" }).first();
    await expect(crossRate).toHaveText("1 USD = 1.3013 SGD");
    expect(await crossRate.getAttribute("value")).toMatch(/^1\.3013\d{10,}$/);
    await expect(page.getByText("1 Jan 2099")).toBeVisible();

    await page.getByLabel("Base currency").selectOption("EUR");
    await page.getByLabel("Quote currency").selectOption("USD");
    await page.getByRole("button", { name: "Preview shock" }).click();
    await expect(page.locator("data").filter({ hasText: "1 EUR =" }).first()).toHaveText("1 EUR = 1.0856 USD");
    await expect(page.locator("data").filter({ hasText: "1 EUR =" }).nth(1)).toHaveText("1 EUR = 0.9770 USD");
    await page.getByRole("button", { name: "Save shock to scenario" }).click();
    await expect(page.getByRole("status").filter({ hasText: "FX shock saved to this scenario." })).toBeVisible();

    const saved = page.getByLabel("Saved FX shocks");
    await expect(saved).toContainText("-10% on EUR/USD");
    await expect(saved).toContainText("ECB 1 Jan 2099");
    await expect(saved).toContainText("1.0856");
    await expect(saved).not.toContainText("snapshot");
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  } finally {
    await account.db.query(`DELETE FROM scenarios WHERE workspace_id IN (SELECT w.id FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.email = $1)`, [account.email]);
    await account.db.query("DELETE FROM fx_snapshots WHERE effective_date = $1 AND provider = 'ecb'", [effective]);
  }
});
