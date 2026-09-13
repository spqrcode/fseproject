import { spawnSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name ends in _test.");
}
const commands = {
  migrate: ["scripts/migrate.mjs"],
  integration: ["node_modules/vitest/vitest.mjs", "run", "tests/integration"],
  e2e: ["node_modules/@playwright/test/cli.js", "test"],
};
const command = commands[process.argv[2]];
if (!command) throw new Error("Expected migrate, integration, or e2e.");
const result = spawnSync(process.execPath, command, {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, APP_ORIGIN: "http://localhost:3100" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
