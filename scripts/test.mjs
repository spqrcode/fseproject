import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name ends in _test.");
}
const commands = {
  migrate: ["scripts/migrate.mjs"],
  integration: ["node_modules/vitest/vitest.mjs", "run", "tests/integration"],
  e2e: ["node_modules/@playwright/test/cli.js", "test"],
};
const mode = process.argv[2];
let env = { ...process.env, DATABASE_URL: url, APP_ORIGIN: "http://localhost:3100" };
if (mode === "integration:runtime") {
  // The application connects as the restricted staging role (TEST_RUNTIME_DATABASE_URL) while fixtures and cleanup
  // use the owner connection (TEST_DATABASE_URL). Only files that were written for this split run: they read
  // TEST_FIXTURES_DATABASE_URL. The others use one connection for everything and need the owner's rights.
  const runtime = process.env.TEST_RUNTIME_DATABASE_URL;
  if (!runtime) throw new Error("Set TEST_RUNTIME_DATABASE_URL to the connection of the role fse_runtime on the TEST_DATABASE_URL database.");
  const owner = new URL(url), restricted = new URL(runtime);
  if (restricted.host !== owner.host || restricted.pathname !== owner.pathname || restricted.username === owner.username) {
    throw new Error("TEST_RUNTIME_DATABASE_URL must be another user on the same server and database as TEST_DATABASE_URL.");
  }
  const directory = "tests/integration";
  const files = readdirSync(directory).filter(name => name.endsWith(".test.ts") && readFileSync(`${directory}/${name}`, "utf8").includes("TEST_FIXTURES_DATABASE_URL")).map(name => `${directory}/${name}`);
  if (files.length === 0) throw new Error("No integration file reads TEST_FIXTURES_DATABASE_URL.");
  commands[mode] = ["node_modules/vitest/vitest.mjs", "run", ...files];
  env = { ...env, DATABASE_URL: runtime, TEST_FIXTURES_DATABASE_URL: url };
}
const command = commands[mode];
if (!command) throw new Error("Expected migrate, integration, integration:runtime, or e2e.");
const result = spawnSync(process.execPath, command, { stdio: "inherit", env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
