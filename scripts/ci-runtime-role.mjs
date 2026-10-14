// Creates the restricted application role of the staging database in a _test database, so that data-store tests
// can run with the application connected as that role (npm run test:integration:runtime) and a missing or
// too-broad grant fails the tests instead of being found by hand.
//
// Two steps, because the role must exist BEFORE the migrations (their guarded "IF EXISTS pg_roles ... GRANT"
// blocks only run when it does) while the base grants can only be given AFTER the migrations created the tables:
//   node scripts/ci-runtime-role.mjs role          before  npm run db:migrate:test
//   node scripts/ci-runtime-role.mjs base-grants   after   npm run db:migrate:test
//
// Reads the owner connection from TEST_DATABASE_URL and the role's connection, including its CI-only password,
// from TEST_RUNTIME_DATABASE_URL. The grants in migrations 003-008 are not repeated here; they come from the
// migrations themselves.
import pg from "pg";

const owner = process.env.TEST_DATABASE_URL;
const runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (!owner || !new URL(owner).pathname.endsWith("_test")) throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name ends in _test.");
if (!runtime) throw new Error("Set TEST_RUNTIME_DATABASE_URL to the connection of the role fse_runtime on the same database.");
const ownerUrl = new URL(owner);
const runtimeUrl = new URL(runtime);
if (runtimeUrl.username !== "fse_runtime" || !runtimeUrl.password) throw new Error("TEST_RUNTIME_DATABASE_URL must use the user fse_runtime and a password.");
if (runtimeUrl.host !== ownerUrl.host || runtimeUrl.pathname !== ownerUrl.pathname) throw new Error("TEST_RUNTIME_DATABASE_URL must point to the same server and database as TEST_DATABASE_URL.");

// The base grants of the staging role that no migration gives. This mirrors the first paragraph of the
// "Staging configuration" section of docs/deployment.md and must change together with it.
const baseGrants = [
  "GRANT SELECT, INSERT ON users TO fse_runtime",
  "GRANT SELECT, INSERT, DELETE ON sessions TO fse_runtime",
  "GRANT SELECT, INSERT, UPDATE ON auth_limits, workspaces TO fse_runtime",
];

const step = process.argv[2];
if (step !== "role" && step !== "base-grants") throw new Error("Expected the step role or base-grants.");
const client = new pg.Client({ connectionString: owner });
await client.connect();
try {
  if (step === "role") {
    const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'fse_runtime'")).rowCount === 1;
    // CREATE ROLE takes the password as a literal, not as a query parameter. The role gets no extra attributes.
    await client.query(`${exists ? "ALTER" : "CREATE"} ROLE fse_runtime LOGIN PASSWORD ${client.escapeLiteral(decodeURIComponent(runtimeUrl.password))}`);
    console.log(`${exists ? "Updated" : "Created"} role fse_runtime`);
  } else {
    for (const grant of baseGrants) await client.query(grant);
    console.log(`Applied ${baseGrants.length} base grants to fse_runtime`);
  }
} finally { await client.end(); }
