/**
 * Scenario FX Shock database persistence and resolution.
 *
 * Enforces:
 *  - Ownership derived strictly from session token (joining through sessions + scenarios).
 *  - Cross-user and cross-scenario isolation.
 *  - Shock adjustments reference persisted FX snapshots without copying or mutating them.
 *  - No ECB network calls occur during shock evaluation.
 */

import "server-only";
import { database } from "@/lib/db";
import { hasValidSession, tokenHash, validToken } from "@/lib/session-store";
import { parseDecimal, decimalString } from "@/lib/forecast/decimal";
import type { EvaluatedFxShock } from "@/lib/fx/fx-shock";
import {
  DuplicateFxShockError,
  evaluateFxShock,
  MissingSnapshotError,
  parseShockPercent,
  UnusableSnapshotError,
} from "@/lib/fx/fx-shock";
import type { FxSnapshot } from "@/lib/fx/snapshot-store";
import { uuidSchema } from "@/lib/validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersistedFxShock = Readonly<{
  id: string;
  scenarioId: string;
  snapshotId: string;
  shockPercent: string;
  status: "active" | "invalid";
  createdAt: Date;
  updatedAt: Date;
}>;

interface ShockRow {
  id: string;
  scenario_id: string;
  snapshot_id: string;
  shock_percent: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface JoinedShockRow extends ShockRow {
  provider: string | null;
  base_currency: string | null;
  quote_currency: string | null;
  rate: string | null;
  effective_date: string | Date | null;
  fetched_at: Date | null;
}

function rowToPersistedShock(row: ShockRow): PersistedFxShock {
  const status = row.status === "active" || row.status === "invalid" ? row.status : "invalid";
  return Object.freeze({
    id: row.id,
    scenarioId: row.scenario_id,
    snapshotId: row.snapshot_id,
    shockPercent: decimalString(parseDecimal(row.shock_percent)),
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Add a percentage FX shock to a scenario.
 *
 * Verifies:
 *  - Session user owns the scenario.
 *  - Target snapshot exists in fx_snapshots.
 *  - shockPercent is a valid decimal strictly > -100%.
 */
export async function addScenarioFxShock(
  token: string | undefined,
  scenarioId: unknown,
  snapshotId: unknown,
  shockPercent: string,
): Promise<PersistedFxShock> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const scenario = uuidSchema.safeParse(scenarioId);
  const snapshot = uuidSchema.safeParse(snapshotId);
  if (!scenario.success || !snapshot.success) {
    throw new Error("Scenario or FX snapshot not found or access denied.");
  }

  // Validate percentage before DB insert: the same range and precision as the database column.
  const shockDec = parseShockPercent(shockPercent);

  let result;
  try {
    result = await database().query<ShockRow>(
      `INSERT INTO scenario_fx_shocks (workspace_id, scenario_id, snapshot_id, shock_percent)
         SELECT sc.workspace_id, sc.id, fx.id, $4::numeric
           FROM sessions s
           JOIN workspaces w ON w.user_id = s.user_id
           JOIN scenarios sc ON sc.workspace_id = w.id AND sc.id = $2
           CROSS JOIN fx_snapshots fx
          WHERE s.token_hash = $1 AND s.expires_at > now()
            AND fx.id = $3
         RETURNING id, scenario_id, snapshot_id, shock_percent::text, status, created_at, updated_at`,
      [tokenHash(token), scenario.data, snapshot.data, decimalString(shockDec)],
    );
  } catch (error) {
    // One shock per scenario and snapshot (unique constraint): a domain error, not a raw database error.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new DuplicateFxShockError();
    }
    throw error;
  }

  if (result.rowCount !== 1) {
    // An expired session is not "not found": say which one it is, as the scenario store does.
    if (!(await hasValidSession(token))) throw new Error("Authentication required.");
    throw new Error("Scenario or FX snapshot not found or access denied.");
  }
  return rowToPersistedShock(result.rows[0]);
}

/**
 * Invalidate a scenario FX shock (e.g. for audit trail).
 */
export async function invalidateScenarioFxShock(
  token: string | undefined,
  shockId: unknown,
): Promise<boolean> {
  if (!token || !validToken(token)) return false;
  const id = uuidSchema.safeParse(shockId);
  if (!id.success) return false;
  const result = await database().query(
    `UPDATE scenario_fx_shocks sfs
        SET status = 'invalid', updated_at = now()
       FROM scenarios sc
       JOIN workspaces w ON w.id = sc.workspace_id
       JOIN sessions s ON s.user_id = w.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sfs.scenario_id = sc.id
        AND sfs.id = $2`,
    [tokenHash(token), id.data],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Reads & Evaluation
// ---------------------------------------------------------------------------

/**
 * Get all FX shock adjustments for a scenario owned by the session user.
 */
export async function getScenarioFxShocks(
  token: string | undefined,
  scenarioId: unknown,
): Promise<PersistedFxShock[]> {
  if (!token || !validToken(token)) return [];
  const id = uuidSchema.safeParse(scenarioId);
  if (!id.success) return [];
  const result = await database().query<ShockRow>(
    `SELECT sfs.id, sfs.scenario_id, sfs.snapshot_id, sfs.shock_percent::text,
            sfs.status, sfs.created_at, sfs.updated_at
       FROM scenario_fx_shocks sfs
       JOIN scenarios sc ON sc.id = sfs.scenario_id
       JOIN workspaces w ON w.id = sc.workspace_id
       JOIN sessions s ON s.user_id = w.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sfs.scenario_id = $2
      ORDER BY sfs.created_at ASC`,
    [tokenHash(token), id.data],
  );
  return result.rows.map(rowToPersistedShock);
}

/**
 * Evaluate an FX shock adjustment from the database against its referenced snapshot.
 *
 * Pure database read; does NOT invoke the external ECB provider or network.
 */
export async function evaluateScenarioFxShock(
  token: string | undefined,
  scenarioId: unknown,
  shockId: unknown,
): Promise<EvaluatedFxShock> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const scenario = uuidSchema.safeParse(scenarioId);
  const shock = uuidSchema.safeParse(shockId);
  if (!scenario.success || !shock.success) {
    throw new Error("FX shock not found or access denied.");
  }

  const result = await database().query<JoinedShockRow>(
    `SELECT sfs.id, sfs.scenario_id, sfs.snapshot_id, sfs.shock_percent::text, sfs.status,
            sfs.created_at, sfs.updated_at,
            fx.provider, fx.base_currency, fx.quote_currency, fx.rate::text AS rate,
            fx.effective_date::text AS effective_date, fx.fetched_at
       FROM scenario_fx_shocks sfs
       JOIN scenarios sc ON sc.id = sfs.scenario_id
       JOIN workspaces w ON w.id = sc.workspace_id
       JOIN sessions s ON s.user_id = w.user_id
       JOIN fx_snapshots fx ON fx.id = sfs.snapshot_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sfs.scenario_id = $2
        AND sfs.id = $3`,
    [tokenHash(token), scenario.data, shock.data],
  );

  if (result.rows.length === 0) {
    throw new Error("FX shock not found or access denied.");
  }

  const row = result.rows[0];
  if (row.status === "invalid") {
    throw new UnusableSnapshotError("FX shock adjustment has status 'invalid'");
  }

  if (!row.snapshot_id || !row.rate || !row.provider || !row.base_currency || !row.quote_currency || !row.effective_date || !row.fetched_at) {
    throw new MissingSnapshotError(row.snapshot_id);
  }

  const snapshot: FxSnapshot = Object.freeze({
    id: row.snapshot_id,
    provider: row.provider,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: row.rate,
    effectiveDate: typeof row.effective_date === "string" ? row.effective_date.slice(0, 10) : row.effective_date.toISOString().slice(0, 10),
    fetchedAt: row.fetched_at,
  });

  return evaluateFxShock(snapshot, row.shock_percent);
}
