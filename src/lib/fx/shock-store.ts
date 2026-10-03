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
import { tokenHash, validToken } from "@/lib/session-store";
import { parseDecimal, decimalString } from "@/lib/forecast/decimal";
import type { EvaluatedFxShock } from "@/lib/fx/fx-shock";
import {
  evaluateFxShock,
  InvalidShockPercentageError,
  MissingSnapshotError,
  UnusableSnapshotError,
} from "@/lib/fx/fx-shock";
import type { FxSnapshot } from "@/lib/fx/snapshot-store";

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
  state: string | null;
  rejection_reason: string | null;
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
  scenarioId: string,
  snapshotId: string,
  shockPercent: string,
): Promise<PersistedFxShock> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");

  // Validate percentage before DB insert
  let shockDec;
  try {
    shockDec = parseDecimal(shockPercent);
  } catch {
    throw new InvalidShockPercentageError(shockPercent);
  }

  if (shockDec.lessThanOrEqualTo(-100)) {
    throw new InvalidShockPercentageError(
      shockPercent,
      "Shock percentage must be strictly greater than -100%.",
    );
  }

  // Verify ownership of the scenario and existence of the snapshot
  const check = await database().query<{ scenario_ok: boolean; snapshot_ok: boolean; snapshot_state: string | null }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM scenarios sc
           JOIN sessions s ON s.user_id = sc.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now() AND sc.id = $2
       ) AS scenario_ok,
       EXISTS (
         SELECT 1 FROM fx_snapshots fx WHERE fx.id = $3
       ) AS snapshot_ok,
       (SELECT fx.state FROM fx_snapshots fx WHERE fx.id = $3) AS snapshot_state`,
    [tokenHash(token), scenarioId, snapshotId],
  );

  const { scenario_ok, snapshot_ok, snapshot_state } = check.rows[0];
  if (!scenario_ok) throw new Error("Scenario not found or access denied.");
  if (!snapshot_ok) throw new MissingSnapshotError(snapshotId);
  if (snapshot_state !== "accepted") {
    throw new UnusableSnapshotError(`snapshot state is "${snapshot_state}"`, snapshotId);
  }

  const result = await database().query<ShockRow>(
    `INSERT INTO scenario_fx_shocks (scenario_id, snapshot_id, shock_percent)
       VALUES ($1, $2, $3::numeric)
       RETURNING id, scenario_id, snapshot_id, shock_percent::text, status, created_at, updated_at`,
    [scenarioId, snapshotId, decimalString(shockDec)],
  );

  if (result.rowCount !== 1) throw new Error("Failed to create FX shock adjustment.");
  return rowToPersistedShock(result.rows[0]);
}

/**
 * Invalidate a scenario FX shock (e.g. for audit trail).
 */
export async function invalidateScenarioFxShock(
  token: string | undefined,
  shockId: string,
): Promise<boolean> {
  if (!token || !validToken(token)) return false;
  const result = await database().query(
    `UPDATE scenario_fx_shocks sfs
        SET status = 'invalid', updated_at = now()
       FROM scenarios sc
       JOIN sessions s ON s.user_id = sc.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sfs.scenario_id = sc.id
        AND sfs.id = $2`,
    [tokenHash(token), shockId],
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
  scenarioId: string,
): Promise<PersistedFxShock[]> {
  if (!token || !validToken(token)) return [];
  const result = await database().query<ShockRow>(
    `SELECT sfs.id, sfs.scenario_id, sfs.snapshot_id, sfs.shock_percent::text,
            sfs.status, sfs.created_at, sfs.updated_at
       FROM scenario_fx_shocks sfs
       JOIN scenarios sc ON sc.id = sfs.scenario_id
       JOIN sessions s ON s.user_id = sc.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sfs.scenario_id = $2
      ORDER BY sfs.created_at ASC`,
    [tokenHash(token), scenarioId],
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
  scenarioId: string,
  shockId: string,
): Promise<EvaluatedFxShock> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");

  const result = await database().query<JoinedShockRow>(
    `SELECT sfs.id, sfs.scenario_id, sfs.snapshot_id, sfs.shock_percent::text, sfs.status,
            sfs.created_at, sfs.updated_at,
            fx.provider, fx.base_currency, fx.quote_currency, fx.rate::text AS rate,
            fx.effective_date::text AS effective_date, fx.fetched_at, fx.state, fx.rejection_reason
       FROM scenario_fx_shocks sfs
       JOIN scenarios sc ON sc.id = sfs.scenario_id
       JOIN sessions s ON s.user_id = sc.user_id
  LEFT JOIN fx_snapshots fx ON fx.id = sfs.snapshot_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sfs.scenario_id = $2
        AND sfs.id = $3`,
    [tokenHash(token), scenarioId, shockId],
  );

  if (result.rows.length === 0) {
    throw new Error("FX shock not found or access denied.");
  }

  const row = result.rows[0];
  if (row.status === "invalid") {
    throw new UnusableSnapshotError("FX shock adjustment has status 'invalid'");
  }

  if (!row.snapshot_id || !row.rate || !row.provider || !row.base_currency || !row.quote_currency || !row.effective_date || !row.fetched_at || !row.state) {
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
    state: row.state === "accepted" ? "accepted" : "rejected",
    rejectionReason: row.rejection_reason,
  });

  return evaluateFxShock(snapshot, row.shock_percent);
}
