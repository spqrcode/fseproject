/**
 * Integration tests for Scenario FX shock persistence and resolution against real PostgreSQL.
 *
 * Verifies:
 *  1. Persisting FX shock adjustments in `scenario_fx_shocks` (migration 007).
 *  2. Database CHECK constraint enforces shock_percent > -100%.
 *  3. Unique constraint UNIQUE(scenario_id, snapshot_id) prevents conflicting duplicate shocks.
 *  4. ON DELETE RESTRICT on fx_snapshots prevents deletion of referenced historical rates.
 *  5. Resolving and evaluating scenario shock from real PostgreSQL.
 *  6. Invalidating shock in PostgreSQL surfaces unusable state.
 */

import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { database } from "@/lib/db";
import { createSession } from "@/lib/session-store";
import { createScenario } from "@/lib/scenario-store";
import { upsertSnapshot } from "@/lib/fx/snapshot-store";
import {
  addScenarioFxShock,
  getScenarioFxShocks,
  evaluateScenarioFxShock,
  invalidateScenarioFxShock,
} from "@/lib/fx/shock-store";
import { convertWithShock, UnusableSnapshotError } from "@/lib/fx/fx-shock";
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

    const scenario = await createScenario(token, "Stress Test USD Depreciation");
    scenarioId = scenario.id;

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
    expect(dbRow.rows[0].shock_percent).toBe("5.000000"); // NUMERIC(18,6)
    expect(dbRow.rows[0].status).toBe("active");
  });

  it("enforces database CHECK constraint rejecting shock_percent <= -100", async () => {
    await expect(
      database().query(
        "INSERT INTO scenario_fx_shocks (scenario_id, snapshot_id, shock_percent) VALUES ($1, $2, -100)",
        [scenarioId, snapshotId],
      ),
    ).rejects.toThrow();

    await expect(
      database().query(
        "INSERT INTO scenario_fx_shocks (scenario_id, snapshot_id, shock_percent) VALUES ($1, $2, -105)",
        [scenarioId, snapshotId],
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
});
