/**
 * Integration tests for Scenario FX shock persistence and resolution against real PostgreSQL.
 *
 * Verifies:
 *  1. Persisting FX shock adjustments in `scenario_fx_shocks` (migration 008).
 *  2. Database CHECK constraint enforces shock_percent > -100%.
 *  3. Unique constraint UNIQUE(scenario_id, snapshot_id) prevents conflicting duplicate shocks.
 *  4. ON DELETE RESTRICT on fx_snapshots prevents deletion of referenced historical rates.
 *  5. Resolving and evaluating scenario shock from real PostgreSQL.
 *  6. Invalidating shock in PostgreSQL surfaces unusable state.
 */

import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { createScenario } from "@/lib/scenario-store";
import { saveWorkspace } from "@/lib/workspace-store";
import { upsertSnapshot } from "@/lib/fx/snapshot-store";
import {
  addScenarioFxShock,
  getScenarioFxShocks,
  evaluateScenarioFxShock,
  invalidateScenarioFxShock,
} from "@/lib/fx/shock-store";
import { convertWithShock, DuplicateFxShockError, InvalidShockPercentageError, UnusableSnapshotError } from "@/lib/fx/fx-shock";
import { money, roundMoney } from "@/lib/forecast";

// ---------------------------------------------------------------------------
// Guard: must run against the isolated test database
// ---------------------------------------------------------------------------
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test") || process.env.DATABASE_URL !== url) {
  throw new Error("Run npm run test:integration against an isolated _test database.");
}

// ---------------------------------------------------------------------------
// Mock Next.js headers (required by server-only imports)
// ---------------------------------------------------------------------------
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "http://localhost:3100" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emails: string[] = [];
let token: string;
let scenarioId: string;
let snapshotId: string;
let workspaceId: string;

async function createTestUser(email: string) {
  const result = await database().query(
    "INSERT INTO users(email, password_hash) VALUES ($1, 'dummy-hash') RETURNING id",
    [email],
  );
  emails.push(email);
  return result.rows[0].id as string;
}

describe("Scenario FX shock persistence (PostgreSQL)", () => {
  beforeEach(async () => {
    const userId = await createTestUser(`fx-shock-${Date.now()}-${Math.random()}@example.com`);
    const session = await createSession(userId);
    token = session.token;

    await saveWorkspace(token, "FX shock test workspace");
    const scenario = await createScenario(token, "Stress Test USD Depreciation");
    scenarioId = scenario.id;
    workspaceId = scenario.workspaceId;

    // Seed a persisted snapshot
    const snap = await upsertSnapshot(
      "ecb",
      {
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.1225",
        effectiveDate: "2026-10-02",
      },
      new Date(),
    );
    snapshotId = snap.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (emails.length > 0) {
      await database().query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
      emails.length = 0;
    }
    await database().query("DELETE FROM fx_snapshots WHERE provider = 'ecb'");
  });

  afterAll(async () => {
    await database().end();
  });

  it("bounds a stored shock to -99.99..100 with four decimals, in the application and in the database", async () => {
    // The application refuses it before any SQL...
    for (const value of ["5000", "100.0001", "-99.995", "1.00001", "1e5"]) {
      await expect(addScenarioFxShock(token, scenarioId, snapshotId, value)).rejects.toBeInstanceOf(InvalidShockPercentageError);
    }
    // ...and the database refuses it even when the application is bypassed.
    for (const value of ["100.0001", "-99.9901", "5000"]) {
      await expect(database().query(
        "INSERT INTO scenario_fx_shocks (workspace_id, scenario_id, snapshot_id, shock_percent) VALUES ($1, $2, $3, $4)",
        [workspaceId, scenarioId, snapshotId, value],
      ), value).rejects.toMatchObject({ code: expect.stringMatching(/^(23514|22003)$/) });
    }
    expect(await getScenarioFxShocks(token, scenarioId)).toEqual([]);

    // The bounds themselves are accepted and read back unchanged.
    const upper = await addScenarioFxShock(token, scenarioId, snapshotId, "100");
    expect(upper.shockPercent).toBe("100");
    await database().query("DELETE FROM scenario_fx_shocks WHERE id = $1", [upper.id]);
    const lower = await addScenarioFxShock(token, scenarioId, snapshotId, "-99.99");
    expect(lower.shockPercent).toBe("-99.99");
  });

  it("reports a second shock for the same scenario and snapshot as a domain error, and an expired session as authentication", async () => {
    await addScenarioFxShock(token, scenarioId, snapshotId, "5");
    await expect(addScenarioFxShock(token, scenarioId, snapshotId, "7")).rejects.toBeInstanceOf(DuplicateFxShockError);
    expect(await getScenarioFxShocks(token, scenarioId)).toHaveLength(1);

    await database().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT user_id FROM workspaces WHERE id = $1)", [workspaceId]);
    await expect(addScenarioFxShock(token, scenarioId, snapshotId, "9")).rejects.toThrow("Authentication required.");
  });

  // Migration 009 on a database that still has saved shocks from before it (review of #24): the cast to
  // numeric(7,4) would round extra decimals silently, so the migration must refuse instead of changing a saved
  // scenario. Each case puts the column back into its 008 state inside a transaction, inserts a shock, runs the
  // migration's SQL and rolls everything back, so the test database ends unchanged.
  async function inState008(run: (client: Client) => Promise<void>) {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE scenario_fx_shocks DROP CONSTRAINT scenario_fx_shocks_percent_range");
      await client.query("ALTER TABLE scenario_fx_shocks ALTER COLUMN shock_percent TYPE numeric");
      await run(client);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }
  const migration009 = readFileSync("db/migrations/009_scenario_fx_shock_bounds.sql", "utf8");
  const insertShock = (client: Client, value: string) => client.query(
    "INSERT INTO scenario_fx_shocks (workspace_id, scenario_id, snapshot_id, shock_percent) VALUES ($1, $2, $3, $4) RETURNING id",
    [workspaceId, scenarioId, snapshotId, value]);

  it.each(["1.23456", "-99.995", "150", "-99.9901"])("migration 009 refuses an existing shock of %s instead of rounding or keeping it", async value => {
    await inState008(async client => {
      await insertShock(client, value);
      await expect(client.query(migration009)).rejects.toThrow("Migration 009");
    });
  });

  it("migration 009 keeps existing valid shocks exactly as they were", async () => {
    await inState008(async client => {
      const id = (await insertShock(client, "-10.5")).rows[0].id as string;
      await client.query(migration009);
      const row = await client.query("SELECT shock_percent::text AS value FROM scenario_fx_shocks WHERE id = $1", [id]);
      expect(row.rows[0].value).toBe("-10.5000");
      await expect(client.query("SELECT 1 WHERE -10.5000::numeric = $1::numeric", [row.rows[0].value])).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  it("persists a scenario FX shock in PostgreSQL with correct types and status", async () => {
    const shock = await addScenarioFxShock(token, scenarioId, snapshotId, "5");
    expect(shock.id).toBeDefined();
    expect(shock.scenarioId).toBe(scenarioId);
    expect(shock.snapshotId).toBe(snapshotId);
    expect(shock.shockPercent).toBe("5");
    expect(shock.status).toBe("active");

    // Verify row in database
    const dbRow = await database().query(
      "SELECT id, scenario_id, snapshot_id, shock_percent::text, status FROM scenario_fx_shocks WHERE id = $1",
      [shock.id],
    );
    expect(dbRow.rows).toHaveLength(1);
    // numeric(7,4) since migration 009: the column keeps four decimals; the store trims them when it reads.
    expect(dbRow.rows[0].shock_percent).toBe("5.0000");
    expect(dbRow.rows[0].status).toBe("active");
  });

  it("labels a saved shock when a newer cached rate exists without changing its snapshot", async () => {
    const shock = await addScenarioFxShock(token, scenarioId, snapshotId, "-10");
    expect((await getScenarioFxShocks(token, scenarioId))[0].newerSnapshotAvailable).toBe(false);

    const laterFetch = new Date(Date.now() + 60_000);
    await upsertSnapshot("ecb", {
      baseCurrency: "EUR", quoteCurrency: "SGD", rate: "1.50", effectiveDate: "2026-10-03",
    }, laterFetch);
    expect((await getScenarioFxShocks(token, scenarioId))[0].newerSnapshotAvailable).toBe(false);

    // Re-fetching the same observation keeps the same ID and is not a new rate.
    const repeated = await upsertSnapshot("ecb", {
      baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.1225", effectiveDate: "2026-10-02",
    }, laterFetch);
    expect(repeated.id).toBe(snapshotId);
    expect((await getScenarioFxShocks(token, scenarioId))[0].newerSnapshotAvailable).toBe(false);

    // ECB can correct a rate on the same effective date: date comparison alone would miss this.
    await upsertSnapshot("ecb", {
      baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.1300", effectiveDate: "2026-10-02",
    }, new Date(laterFetch.getTime() + 1000));
    const corrected = (await getScenarioFxShocks(token, scenarioId))[0];
    expect(corrected.newerSnapshotAvailable).toBe(true);
    expect(corrected.snapshotId).toBe(snapshotId);
    expect(corrected.snapshot?.rate).toMatch(/^1\.12250*$/);
    expect(corrected.snapshot?.effectiveDate).toBe("2026-10-02");
    expect((await evaluateScenarioFxShock(token, scenarioId, shock.id)).sourceRate).toBe("1.1225");

    await upsertSnapshot("ecb", {
      baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.1400", effectiveDate: "2026-10-03",
    }, new Date(laterFetch.getTime() + 2000));
    expect((await getScenarioFxShocks(token, scenarioId))[0].newerSnapshotAvailable).toBe(true);
  });

  it("enforces database CHECK constraint rejecting shock_percent <= -100", async () => {
    await expect(
      database().query(
        "INSERT INTO scenario_fx_shocks (workspace_id, scenario_id, snapshot_id, shock_percent) VALUES ($1, $2, $3, -100)",
        [workspaceId, scenarioId, snapshotId],
      ),
    ).rejects.toThrow();

    await expect(
      database().query(
        "INSERT INTO scenario_fx_shocks (workspace_id, scenario_id, snapshot_id, shock_percent) VALUES ($1, $2, $3, -105)",
        [workspaceId, scenarioId, snapshotId],
      ),
    ).rejects.toThrow();

    await expect(
      database().query(
        "INSERT INTO scenario_fx_shocks (workspace_id, scenario_id, snapshot_id, shock_percent) VALUES ($1, $2, $3, 'NaN')",
        [workspaceId, scenarioId, snapshotId],
      ),
    ).rejects.toThrow();
  });

  it("enforces UNIQUE(scenario_id, snapshot_id) preventing duplicate shock rows", async () => {
    await addScenarioFxShock(token, scenarioId, snapshotId, "5");

    await expect(
      addScenarioFxShock(token, scenarioId, snapshotId, "10"),
    ).rejects.toThrow();
  });

  it("enforces ON DELETE RESTRICT on fx_snapshots", async () => {
    await addScenarioFxShock(token, scenarioId, snapshotId, "5");

    // Attempting to delete the referenced snapshot row must fail
    await expect(
      database().query("DELETE FROM fx_snapshots WHERE id = $1", [snapshotId]),
    ).rejects.toThrow();
  });

  it("resolves joined shock from PostgreSQL and converts money using reciprocal", async () => {
    const shock = await addScenarioFxShock(token, scenarioId, snapshotId, "5");
    const evaluated = await evaluateScenarioFxShock(token, scenarioId, shock.id);

    expect(evaluated.sourceRate).toBe("1.1225");
    expect(evaluated.shockedRate).toBe("1.178625"); // 1.1225 * 1.05
    expect(evaluated.effectiveDate).toBe("2026-10-02");
    expect(evaluated.provider).toBe("ecb");
    expect(evaluated.isHypothetical).toBe(true);

    // Test conversion and reciprocal round-trip
    const converted = convertWithShock(money("100", "EUR"), "USD", evaluated);
    expect(converted).toEqual({ amount: "117.8625", currency: "USD" });

    const roundTrip = convertWithShock(converted, "EUR", evaluated);
    expect(roundMoney(roundTrip)).toEqual({ amount: "100", currency: "EUR" });
  });

  it("invalidates shock in PostgreSQL and refuses subsequent evaluation", async () => {
    const shock = await addScenarioFxShock(token, scenarioId, snapshotId, "-5");
    const success = await invalidateScenarioFxShock(token, shock.id);
    expect(success).toBe(true);

    const shocks = await getScenarioFxShocks(token, scenarioId);
    expect(shocks[0].status).toBe("invalid");

    await expect(evaluateScenarioFxShock(token, scenarioId, shock.id)).rejects.toThrow(
      UnusableSnapshotError,
    );
  });

  it("does not expose or mutate another workspace's FX shocks", async () => {
    const shock = await addScenarioFxShock(token, scenarioId, snapshotId, "5");
    const otherUserId = await createTestUser(`fx-shock-other-${Date.now()}@example.com`);
    const otherSession = await createSession(otherUserId);
    await saveWorkspace(otherSession.token, "Other FX workspace");
    const otherScenario = await createScenario(otherSession.token, "Other scenario");

    expect(await getScenarioFxShocks(otherSession.token, scenarioId)).toEqual([]);
    expect(await invalidateScenarioFxShock(otherSession.token, shock.id)).toBe(false);
    await expect(
      evaluateScenarioFxShock(otherSession.token, otherScenario.id, shock.id),
    ).rejects.toThrow("FX shock not found or access denied.");
  });

  it("handles malformed ids without PostgreSQL cast errors", async () => {
    await expect(
      addScenarioFxShock(token, "not-a-uuid", snapshotId, "5"),
    ).rejects.toThrow("Scenario or FX snapshot not found or access denied.");
    expect(await getScenarioFxShocks(token, "not-a-uuid")).toEqual([]);
    expect(await invalidateScenarioFxShock(token, "not-a-uuid")).toBe(false);
  });
});
