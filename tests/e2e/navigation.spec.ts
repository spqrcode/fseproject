import { test, expect, signUpAndIn, noSidewaysScroll } from "./fixtures";

const sections = [
  { label: "Liquidity overview", path: "/dashboard", heading: "Liquidity overview" },
  { label: "Cash events", path: "/cash-events", heading: "Cash events" },
  { label: "Scenario lab", path: "/scenarios", heading: "Scenario lab" },
  { label: "Workspace", path: "/workspace", heading: "Your workspace" },
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

test("forecast stays honest and scenario setup requires a workspace", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await expect(page.getByRole("link", { name: "Create your workspace", exact: true })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 2, name: /not connected yet/ })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/[€$£¥]\s?\d|SGD\s\d/);
  await page.goto("/scenarios");
  await expect(page.getByRole("heading", { level: 2, name: "Create your workspace first." })).toBeVisible();
  await page.goto("/cash-events");
  await expect(page.getByRole("heading", { level: 2, name: "Create your workspace first." })).toBeVisible();
});

test("the old Forecast and Portfolio pages are gone, not left behind as duplicates", async ({ page, account }) => {
  await signUpAndIn(page, account);
  for (const path of ["/forecast", "/portfolio"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
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
  await page.goto("/scenarios");
  await expect(page.locator("main")).toContainText("US dollar (USD)");
});

test("an expired session cannot change the currency from a page that is already open", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await page.goto("/settings");
  await account.db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [account.email]);
  await page.getByLabel("Reporting currency").selectOption("SGD");
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
    expect(await noSidewaysScroll(page), section.path).toBeLessThanOrEqual(0);
    // The menu scrolls inside the header; the current section must not be cut off at the edge.
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: section.label, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings", exact: true })).toBeAttached();
});

test("on tablet and small laptop screens the whole menu and sign-out stay on screen", async ({ page, account }) => {
  await signUpAndIn(page, account);
  for (const width of [900, 1024]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/dashboard");
    expect(await noSidewaysScroll(page), `${width}px`).toBeLessThanOrEqual(0);
    for (const section of sections) {
      await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: section.label, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeInViewport({ ratio: 1 });
  }
});
