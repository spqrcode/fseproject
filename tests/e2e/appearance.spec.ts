import { test, expect, signUpAndIn, type Account } from "./fixtures";
import type { Page } from "@playwright/test";

const LIGHT = "rgb(243, 241, 236)";
const DARK = "rgb(17, 18, 20)";
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
async function choose(page: Page, label: string) {
  await page.goto("/settings");
  await page.getByRole("radio", { name: label, exact: true }).check();
  await page.getByRole("button", { name: "Save appearance", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Appearance" })).toHaveText("Appearance saved.");
}
async function storedAppearance(account: Account) {
  return (await account.db.query("SELECT appearance FROM users WHERE email=$1", [account.email])).rows[0].appearance;
}

test("signed-out pages follow the device's light or dark setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  expect(await background(page)).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background(page)).toBe(DARK);
});

test("a saved dark appearance applies everywhere, survives reload and overrides a light device", async ({ page, account }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signUpAndIn(page, account);
  expect(await background(page)).toBe(LIGHT);
  await choose(page, "Dark");
  expect(await background(page)).toBe(DARK);
  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await page.goto("/forecast");
  expect(await background(page)).toBe(DARK);
  expect(await storedAppearance(account)).toBe("dark");
});

test("a saved light appearance overrides a dark device, and matching the device follows it again", async ({ page, account }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signUpAndIn(page, account);
  expect(await background(page)).toBe(DARK);
  await choose(page, "Light");
  expect(await background(page)).toBe(LIGHT);
  await choose(page, "Match this device");
  expect(await background(page)).toBe(DARK);
  await expect(page.getByRole("radio", { name: "Match this device", exact: true })).toBeChecked();
});
