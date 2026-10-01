import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, signUpAndIn } from "./fixtures";

// Automated checks catch a large share of WCAG failures (contrast, names, labels, structure),
// not all of them; keyboard and screen-reader behaviour is covered by the other specs.
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const publicPages = ["/", "/login", "/register", "/no-such-page"];
const privatePages = ["/dashboard", "/forecast", "/scenarios", "/portfolio", "/settings"];

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  return results.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(" ")).join(" | ")}`);
}

for (const scheme of ["light", "dark"] as const) {
  test(`public pages pass WCAG 2.2 AA checks in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of publicPages) {
      await page.goto(path);
      expect(await violations(page), path).toEqual([]);
    }
    await page.goto("/login");
    await page.getByLabel("Email address").fill("nobody@example.com");
    await page.getByLabel("Password", { exact: true }).fill("a wrong long password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await violations(page), "login error").toEqual([]);
  });

  test(`signed-in pages pass WCAG 2.2 AA checks in ${scheme} mode`, async ({ page, account }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signUpAndIn(page, account);
    for (const path of privatePages) {
      await page.goto(path);
      expect(await violations(page), path).toEqual([]);
    }
    await page.getByRole("button", { name: "Save currency", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "saved" })).toBeVisible();
    expect(await violations(page), "settings confirmation").toEqual([]);
  });
}
