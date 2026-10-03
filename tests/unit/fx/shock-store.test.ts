import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  addScenarioFxShock,
  getScenarioFxShocks,
  evaluateScenarioFxShock,
  invalidateScenarioFxShock,
} from "@/lib/fx/shock-store";
import {
  InvalidShockPercentageError,
  MissingSnapshotError,
  UnusableSnapshotError,
} from "@/lib/fx/fx-shock";

// ---------------------------------------------------------------------------
// In-memory mock database
// ---------------------------------------------------------------------------

interface MockScenario {
  id: string;
  user_id: string;
  name: string;
}

interface MockSnapshot {
  id: string;
  provider: string;
  base_currency: string;
  quote_currency: string;
  rate: string;
  effective_date: string;
  fetched_at: Date;
  state: string;
  rejection_reason: string | null;
}

interface MockShock {
  id: string;
  scenario_id: string;
  snapshot_id: string;
  shock_percent: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const mockScenarios: MockScenario[] = [];
const mockSnapshots: MockSnapshot[] = [];
const mockShocks: MockShock[] = [];

// Fixed valid session token for mock tests
const VALID_TOKEN = "test-token-valid-abc123456789";

vi.mock("@/lib/session-store", () => ({
  validToken: (token: string) => token === VALID_TOKEN,
  tokenHash: (token: string) => `hash-${token}`,
}));

vi.mock("@/lib/db", () => ({
  database: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      const sqlNorm = sql.replace(/\s+/g, " ").trim();

      // Check ownership & snapshot existence
      if (sqlNorm.startsWith("SELECT EXISTS ( SELECT 1 FROM scenarios sc JOIN sessions s")) {
        const [, scenarioId, snapshotId] = params as [string, string, string];
        const scenario = mockScenarios.find((s) => s.id === scenarioId);
        const snapshot = mockSnapshots.find((s) => s.id === snapshotId);
        return {
          rows: [
            {
              scenario_ok: Boolean(scenario),
              snapshot_ok: Boolean(snapshot),
              snapshot_state: snapshot ? snapshot.state : null,
            },
          ],
        };
      }

      // INSERT INTO scenario_fx_shocks
      if (sqlNorm.startsWith("INSERT INTO scenario_fx_shocks")) {
        const [scenarioId, snapshotId, shockPercent] = params as [string, string, string];
        const newShock: MockShock = {
          id: randomUUID(),
          scenario_id: scenarioId,
          snapshot_id: snapshotId,
          shock_percent: shockPercent,
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
        };
        mockShocks.push(newShock);
        return {
          rowCount: 1,
          rows: [
            {
              id: newShock.id,
              scenario_id: newShock.scenario_id,
              snapshot_id: newShock.snapshot_id,
              shock_percent: newShock.shock_percent,
              status: newShock.status,
              created_at: newShock.created_at,
              updated_at: newShock.updated_at,
            },
          ],
        };
      }

      // SELECT joined shock and snapshot (evaluateScenarioFxShock)
      if (sqlNorm.includes("LEFT JOIN fx_snapshots fx ON fx.id = sfs.snapshot_id")) {
        const [, qScenarioId, qShockId] = params as [string, string, string];
        const shock = mockShocks.find((s) => s.id === qShockId && s.scenario_id === qScenarioId);
        if (!shock) return { rows: [] };

        const snapshot = mockSnapshots.find((s) => s.id === shock.snapshot_id);
        return {
          rows: [
            {
              id: shock.id,
              scenario_id: shock.scenario_id,
              snapshot_id: shock.snapshot_id,
              shock_percent: shock.shock_percent,
              status: shock.status,
              created_at: shock.created_at,
              updated_at: shock.updated_at,
              provider: snapshot ? snapshot.provider : null,
              base_currency: snapshot ? snapshot.base_currency : null,
              quote_currency: snapshot ? snapshot.quote_currency : null,
              rate: snapshot ? snapshot.rate : null,
              effective_date: snapshot ? snapshot.effective_date : null,
              fetched_at: snapshot ? snapshot.fetched_at : null,
              state: snapshot ? snapshot.state : null,
              rejection_reason: snapshot ? snapshot.rejection_reason : null,
            },
          ],
        };
      }

      // SELECT from scenario_fx_shocks (getScenarioFxShocks)
      if (sqlNorm.startsWith("SELECT sfs.id, sfs.scenario_id, sfs.snapshot_id, sfs.shock_percent::text,")) {
        const [, scenarioId] = params as [string, string];
        const matching = mockShocks.filter((s) => s.scenario_id === scenarioId);
        return {
          rows: matching.map((s) => ({
            id: s.id,
            scenario_id: s.scenario_id,
            snapshot_id: s.snapshot_id,
            shock_percent: s.shock_percent,
            status: s.status,
            created_at: s.created_at,
            updated_at: s.updated_at,
          })),
        };
      }

      // UPDATE status = 'invalid'
      if (sqlNorm.startsWith("UPDATE scenario_fx_shocks sfs SET status = 'invalid'")) {
        const [, shockId] = params as [string, string];
        const shock = mockShocks.find((s) => s.id === shockId);
        if (shock) {
          shock.status = "invalid";
          shock.updated_at = new Date();
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      return { rows: [] };
    },
  }),
}));

describe("Scenario FX shock database store", () => {
  const scenarioId = randomUUID();
  const snapshotId = randomUUID();

  beforeEach(() => {
    mockScenarios.length = 0;
    mockSnapshots.length = 0;
    mockShocks.length = 0;

    mockScenarios.push({
      id: scenarioId,
      user_id: "user-123",
      name: "Q4 FX Sensitivity",
    });

    mockSnapshots.push({
      id: snapshotId,
      provider: "ecb",
      base_currency: "EUR",
      quote_currency: "USD",
      rate: "1.1225",
      effective_date: "2026-10-02",
      fetched_at: new Date(),
      state: "accepted",
      rejection_reason: null,
    });
  });

  describe("addScenarioFxShock", () => {
    it("successfully creates a scenario FX shock", async () => {
      const shock = await addScenarioFxShock(VALID_TOKEN, scenarioId, snapshotId, "5");
      expect(shock.id).toBeDefined();
      expect(shock.scenarioId).toBe(scenarioId);
      expect(shock.snapshotId).toBe(snapshotId);
      expect(shock.shockPercent).toBe("5");
      expect(shock.status).toBe("active");
    });

    it("rejects shock of -100% or less before inserting", async () => {
      await expect(addScenarioFxShock(VALID_TOKEN, scenarioId, snapshotId, "-100")).rejects.toThrow(
        InvalidShockPercentageError,
      );
      await expect(addScenarioFxShock(VALID_TOKEN, scenarioId, snapshotId, "-105")).rejects.toThrow(
        InvalidShockPercentageError,
      );
      expect(mockShocks).toHaveLength(0);
    });

    it("rejects malformed shock percentage", async () => {
      await expect(addScenarioFxShock(VALID_TOKEN, scenarioId, snapshotId, "abc")).rejects.toThrow(
        InvalidShockPercentageError,
      );
    });

    it("throws MissingSnapshotError when snapshot does not exist", async () => {
      const nonExistentSnapshotId = randomUUID();
      await expect(
        addScenarioFxShock(VALID_TOKEN, scenarioId, nonExistentSnapshotId, "5"),
      ).rejects.toThrow(MissingSnapshotError);
    });

    it("throws UnusableSnapshotError when snapshot state is rejected", async () => {
      const rejectedSnapshotId = randomUUID();
      mockSnapshots.push({
        id: rejectedSnapshotId,
        provider: "ecb",
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.1225",
        effective_date: "2026-10-02",
        fetched_at: new Date(),
        state: "rejected",
        rejection_reason: "corrupt",
      });

      await expect(
        addScenarioFxShock(VALID_TOKEN, scenarioId, rejectedSnapshotId, "5"),
      ).rejects.toThrow(UnusableSnapshotError);
    });

    it("requires authentication", async () => {
      await expect(addScenarioFxShock(undefined, scenarioId, snapshotId, "5")).rejects.toThrow(
        "Authentication required.",
      );
    });
  });

  describe("getScenarioFxShocks & evaluateScenarioFxShock", () => {
    it("lists shocks and resolves evaluated shock without network call", async () => {
      const shock = await addScenarioFxShock(VALID_TOKEN, scenarioId, snapshotId, "10");
      const list = await getScenarioFxShocks(VALID_TOKEN, scenarioId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(shock.id);

      const evaluated = await evaluateScenarioFxShock(VALID_TOKEN, scenarioId, shock.id);
      expect(evaluated.sourceRate).toBe("1.1225");
      expect(evaluated.shockedRate).toBe("1.23475"); // 1.1225 * 1.10
      expect(evaluated.isHypothetical).toBe(true);
      expect(evaluated.label).toBe("hypothetical");
      expect(evaluated.effectiveDate).toBe("2026-10-02");
      expect(evaluated.provider).toBe("ecb");
    });

    it("invalidates shock and refuses evaluation of invalidated shock", async () => {
      const shock = await addScenarioFxShock(VALID_TOKEN, scenarioId, snapshotId, "-5");
      const invalidated = await invalidateScenarioFxShock(VALID_TOKEN, shock.id);
      expect(invalidated).toBe(true);

      await expect(evaluateScenarioFxShock(VALID_TOKEN, scenarioId, shock.id)).rejects.toThrow(
        UnusableSnapshotError,
      );
    });
  });
});
