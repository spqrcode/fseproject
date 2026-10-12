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
    await expect(saved).not.toContainText("Newer ECB rate available");

    // A correction for the same ECB date should flag the newer cached rate, but not rebase the saved shock.
    await account.db.query(`INSERT INTO fx_snapshots (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
      VALUES ('ecb','EUR','USD',1.0910,$1,now() + interval '1 minute')`, [effective]);
    await page.reload();
    await expect(saved).toContainText("Newer ECB rate available");
    await expect(saved).toContainText("ECB 1 Jan 2099");
    await expect(saved).toContainText("1.0856");
    await expect(saved).not.toContainText("1.0910");
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  } finally {
    await account.db.query(`DELETE FROM scenarios WHERE workspace_id IN (SELECT w.id FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.email = $1)`, [account.email]);
    await account.db.query("DELETE FROM fx_snapshots WHERE effective_date = $1 AND provider = 'ecb'", [effective]);
  }
});

test("an invoice that is received after it was delayed is shown as no longer applying, and the page keeps working", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await page.goto("/workspace");
  await page.getByLabel("Workspace name").fill("Settled later");
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
  await expect(page.getByRole("table", { name: "Invoice delay comparison" })).toContainText("16 Nov 2026");

  // The invoice is received while the scenario exists (in another tab or session).
  await account.db.query("UPDATE cash_events SET status = 'received' WHERE description = 'Customer invoice'");
  await page.reload();
  const comparison = page.getByRole("table", { name: "Invoice delay comparison" });
  await expect(comparison).toContainText("No longer applies");
  await expect(comparison).not.toContainText("16 Nov 2026");
  await expect(page.getByRole("heading", { level: 2, name: "Late customer payment" })).toBeVisible();
});

const DAY_MS = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

test("a delayed invoice is compared with the base forecast, side by side, and the effects add up", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await page.goto("/workspace");
  await page.getByLabel("Workspace name").fill("Comparison workspace");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace saved.");

  await page.goto("/cash-events");
  await page.getByLabel("Account name").fill("Operating cash");
  await page.getByLabel("Currency").selectOption("EUR");
  await page.getByLabel("Opening balance").fill("1000");
  await page.getByRole("button", { name: "Add cash account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cash account added." })).toBeVisible();
  for (const [description, amount, date] of [["Customer invoice", "600", iso(5)], ["Office rent", "-700", iso(10)]] as const) {
    // Once an event exists, its editor adds a second set of fields: the new-event form is always the first one.
    await page.getByLabel("Description").first().fill(description);
    await page.getByLabel("Signed amount").first().fill(amount);
    await page.getByLabel("Expected date").first().fill(date);
    await page.getByRole("button", { name: "Add cash event", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Cash event added." })).toBeVisible();
  }

  await page.goto("/scenarios");
  await expect(page.getByRole("heading", { level: 2, name: "Start with a named scenario." })).toBeVisible();
  await page.getByLabel("Scenario name").fill("Late customer");
  await page.getByRole("button", { name: "Create scenario", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Scenario created." })).toBeVisible();
  await expect(page.getByText("Delay an invoice above to see its effect")).toBeVisible();

  await page.getByLabel("New expected date").fill(iso(20));
  await page.getByRole("button", { name: "Delay invoice in scenario" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invoice delayed in this scenario." })).toBeVisible();

  // Opening 1000: base lowest 900 (the invoice arrives before the rent), scenario lowest 300 (it arrives after).
  const table = page.getByRole("table", { name: "Base forecast and scenario forecast side by side" });
  await expect(table.getByRole("row", { name: /Lowest balance/ }).first()).toContainText("€900.00");
  await expect(table.getByRole("row", { name: /^Lowest balance/ })).toContainText("€300.00");
  await expect(table.getByRole("row", { name: /^Lowest balance/ })).toContainText("-€600.00");
  // 300 is below the 50% threshold of 500 only in the scenario.
  await expect(table.getByRole("row", { name: /First day below/ })).toContainText("Not reached");
  // The invoice still arrives inside the 90 days, so the closing balance does not change and the effects add up.
  await expect(page.getByText("Difference in closing balance")).toContainText("€0.00");
  await expect(page.getByText("Still arrives inside the forecast range")).toBeVisible();

  // The real events are untouched.
  await page.goto("/cash-events");
  // ISO text or formatted, depending on whether the Cash events formatting change from #16 has reached this branch.
  const written = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso(5)}T00:00:00Z`));
  await expect(page.getByText(new RegExp(`^(${iso(5)}|${written})$`))).toBeVisible();
  await expect(page.getByText(new RegExp(`^(${iso(20)}|${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso(20)}T00:00:00Z`))})$`))).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the comparison passes WCAG 2.2 AA checks in ${scheme} mode and fits a phone`, async ({ page, account }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await signUpAndIn(page, account);
    await page.goto("/workspace");
    await page.getByLabel("Workspace name").fill("A11y workspace");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Workspace saved.");
    const created = (await account.db.query(`INSERT INTO cash_accounts(workspace_id, name, currency, opening_balance)
      SELECT w.id, 'Operating cash', 'EUR', 1000 FROM workspaces w JOIN users u ON u.id = w.user_id WHERE u.email = $1 RETURNING id, workspace_id`, [account.email])).rows[0];
    const rows = [["Customer invoice", 600, iso(5)], ["Office rent", -700, iso(10)]] as const;
    for (const [description, amount, date] of rows) {
      await account.db.query("INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date) VALUES ($1,$2,$3,$4,$5)",
        [created.workspace_id, created.id, description, amount, date]);
    }
    await page.goto("/scenarios");
    await page.getByLabel("Scenario name").fill("Late customer");
    await page.getByRole("button", { name: "Create scenario", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Scenario created." })).toBeVisible();
    await page.getByLabel("New expected date").fill(iso(20));
    await page.getByRole("button", { name: "Delay invoice in scenario" }).click();
    await expect(page.getByRole("table", { name: "Base forecast and scenario forecast side by side" })).toBeVisible();
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}
