import { test, expect, signUpAndIn, noSidewaysScroll } from "./fixtures";

test("signed-out visitors see what FinTwin Global is and can start from there", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle("FinTwin Global");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your finances, and their twin.");
  const views = page.getByRole("region", { name: "Three views of the same money" });
  await expect(views.getByRole("listitem")).toHaveCount(3);
  await expect(views.getByText("In development")).toHaveCount(2);
  await page.getByRole("link", { name: "Create your account", exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole("link", { name: "FinTwin Global home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("signed-in users go straight to their workspace", async ({ page, account }) => {
  await signUpAndIn(page, account);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("the home page does not scroll sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
});
