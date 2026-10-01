import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before migrating.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(18493022)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const directory = new URL("../db/migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter(n => n.endsWith(".sql")).sort()) {
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
    if (applied.rowCount) continue;
    await client.query("BEGIN");
    try {
      await client.query(await readFile(new URL(name, directory), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} finally { await client.end(); }
