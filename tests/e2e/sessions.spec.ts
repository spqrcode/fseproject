import { test, expect, signUpAndIn, signIn } from "./fixtures";

test("signing out of other sessions ends them and keeps this browser signed in", async ({ page, browser, account }) => {
  await signUpAndIn(page, account);
  const laptop = await browser.newContext();
  try {
    const other = await laptop.newPage();
    await signIn(other, account);
    await page.goto("/settings");
    const table = page.getByRole("table", { name: "Your active sessions" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table.getByText("This browser")).toHaveCount(1);
    await page.getByRole("button", { name: "Sign out of 1 other session", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Signed out" })).toHaveText("Signed out of 1 other session.");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "No other sessions", exact: true })).toBeDisabled();
    await other.goto("/dashboard");
    await expect(other).toHaveURL(/\/login$/);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  } finally { await laptop.close(); }
});
