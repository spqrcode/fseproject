import { afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";

// The executable version of the grant table in docs/deployment.md: it reads what the staging role fse_runtime can
// actually do in the test database and compares it, exactly, with the map below. A missing privilege and an extra
// one both fail. Change this map, docs/deployment.md and the grants (scripts/ci-runtime-role.mjs, migrations
// 003-008) together.
//
// It runs only in the runtime step (npm run test:integration:runtime), where scripts/test.mjs sets
// TEST_FIXTURES_DATABASE_URL, and is skipped in the plain integration run. Reading that variable also puts the file
// into the runtime step, like the other data-store tests. It only reads the catalog.
const runtimeStep = Boolean(process.env.TEST_FIXTURES_DATABASE_URL);
const url = process.env.TEST_FIXTURES_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}
const pool = new Pool({ connectionString: url, max: 1 });
const ROLE = "fse_runtime";
const roleExists = runtimeStep && (await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE])).rowCount === 1;
// In the runtime step a missing role is skipped locally, but in CI it would silently remove the check, so it fails.
if (runtimeStep && !roleExists && process.env.CI) throw new Error(`The role ${ROLE} does not exist, but CI must test its privileges. Run scripts/ci-runtime-role.mjs before the migrations.`);
const skippedBecause = runtimeStep
  ? `The role ${ROLE} does not exist on this server, so its privileges are not checked. Create it with scripts/ci-runtime-role.mjs, see docs/testing.md.`
  : "Skipped here: the privileges of the role are checked in the runtime step, npm run test:integration:runtime, see docs/testing.md.";
afterAll(async () => { await pool.end(); });

type ColumnPrivilege = "SELECT" | "INSERT" | "UPDATE" | "REFERENCES";
// table: privileges held on the whole table. columns: privileges held on single columns only, per privilege.
type Grants = { table: string[]; columns: Partial<Record<ColumnPrivilege, string[]>> };

// Every table of the schema. schema_migrations is created by scripts/migrate.mjs, not by a migration file.
const expected: Record<string, Grants> = {
  users: { table: ["INSERT", "SELECT"], columns: { UPDATE: ["appearance", "reporting_currency"] } },
  sessions: { table: ["DELETE", "INSERT", "SELECT"], columns: {} },
  auth_limits: { table: ["INSERT", "SELECT", "UPDATE"], columns: {} },
  workspaces: { table: ["INSERT", "SELECT", "UPDATE"], columns: {} },
  cash_accounts: { table: ["INSERT", "SELECT"], columns: { UPDATE: ["name", "updated_at"] } },
  cash_events: { table: ["DELETE", "INSERT", "SELECT"], columns: { UPDATE: ["amount", "description", "expected_date", "status", "updated_at"] } },
  fx_snapshots: { table: ["INSERT", "SELECT"], columns: { UPDATE: ["fetched_at"] } },
  scenarios: { table: ["INSERT", "SELECT"], columns: {} },
  scenario_adjustments: { table: ["INSERT", "SELECT"], columns: { UPDATE: ["status", "updated_at"] } },
  scenario_fx_shocks: { table: ["INSERT", "SELECT"], columns: { UPDATE: ["status", "updated_at"] } },
  schema_migrations: { table: [], columns: {} },
};

const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const COLUMN_PRIVILEGES: ColumnPrivilege[] = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];

async function tableNames() {
  const result = await pool.query<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY c.relname`);
  return result.rows.map(row => row.relname);
}
// What the role holds on one table, in the same shape as the expected map. A column privilege only counts as
// column-level when the table-level privilege is not held, because has_column_privilege is also true for those.
async function actualGrants(table: string): Promise<Grants> {
  const regclass = `public."${table}"`;
  const onTable = await pool.query<{ privilege: string }>(
    "SELECT p AS privilege FROM unnest($2::text[]) AS p WHERE has_table_privilege($1, $3::regclass, p) ORDER BY p", [ROLE, TABLE_PRIVILEGES, regclass]);
  const table_ = onTable.rows.map(row => row.privilege);
  const onColumns = await pool.query<{ privilege: ColumnPrivilege; column: string }>(
    `SELECT p AS privilege, a.attname AS column FROM pg_attribute a CROSS JOIN unnest($2::text[]) AS p
     WHERE a.attrelid = $3::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege($1, a.attrelid, a.attnum, p)
     ORDER BY p, a.attname`, [ROLE, COLUMN_PRIVILEGES, regclass]);
  const columns: Grants["columns"] = {};
  for (const row of onColumns.rows) {
    if (table_.includes(row.privilege)) continue;
    (columns[row.privilege] ??= []).push(row.column);
  }
  return { table: table_, columns };
}
const sorted = (grants: Grants): Grants => ({
  table: [...grants.table].sort(),
  columns: Object.fromEntries(Object.entries(grants.columns).map(([privilege, columns]) => [privilege, [...columns].sort()])),
});

// A skipped file prints nothing by itself, and console output is hidden by the default reporter, so the skip
// happens inside a test that writes the reason to stderr.
if (!roleExists) {
  it(runtimeStep ? "is skipped: the staging role does not exist here" : "is skipped: it runs in test:integration:runtime", ctx => { process.stderr.write(`[runtime-privileges] ${skippedBecause}\n`); ctx.skip(skippedBecause); });
} else describe("the staging role fse_runtime", () => {
  it("is a plain login role with no administrative attributes, memberships or owned objects", async () => {
    const role = (await pool.query("SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", [ROLE])).rows[0];
    expect(role).toEqual({ rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
    const memberships = await pool.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1", [ROLE]);
    expect(memberships.rowCount).toBe(0);
    const owned = await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1
      UNION ALL SELECT n.nspname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = $1`, [ROLE]);
    expect(owned.rows).toEqual([]);
  });

  it("cannot create schema objects in the public schema or the database", async () => {
    const result = await pool.query("SELECT has_schema_privilege($1, 'public', 'CREATE') AS schema, has_database_privilege($1, current_database(), 'CREATE') AS database", [ROLE]);
    expect(result.rows[0]).toEqual({ schema: false, database: false });
  });

  it("has a map entry for every table, and no table is missing from the database", async () => {
    expect(await tableNames()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.keys(expected))("holds exactly the documented privileges on %s", async table => {
    expect(sorted(await actualGrants(table))).toEqual(sorted(expected[table]));
  });
});
