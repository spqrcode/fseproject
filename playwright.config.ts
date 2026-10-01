import { defineConfig, devices } from "@playwright/test";
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test") || process.env.DATABASE_URL !== testUrl) {
  throw new Error("Run npm run test:e2e to use the isolated test database.");
}
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1,
  forbidOnly: !!process.env.CI, retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:3100", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://localhost:3100/login", reuseExistingServer: false, timeout: 60000,
    env: { DATABASE_URL: testUrl, APP_ORIGIN: "http://localhost:3100" },
  },
});
