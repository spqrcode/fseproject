/**
 * Scenario and ScenarioAdjustment persistence.
 *
 * Ownership is always derived from the session token — never from a
 * browser-submitted user or scenario ID.  Queries join through sessions
 * the same way portfolio-store.ts and cash-event-store.ts do.
 *
 * An adjustment whose target event has been deleted has status='invalid'
 * in the database.  The store surfaces this explicitly rather than silently
 * omitting the adjustment.
 */

import "server-only";
import { database } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/session-store";
import type { DelayAdjustment } from "@/lib/forecast/scenario";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ScenarioRow {
  id: string;
  user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

interface AdjustmentRow {
  id: string;
  scenario_id: string;
  cash_event_id: string;
  date_override: Date; // pg DATE → JS Date
  status: string;
}

export type Scenario = {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

function rowToAdjustment(row: AdjustmentRow): DelayAdjustment {
  const status = row.status === "active" || row.status === "invalid" ? row.status : "invalid";
  return Object.freeze({
    id: row.id,
    scenarioId: row.scenario_id,
    cashEventId: row.cash_event_id,
    dateOverride: row.date_override.toISOString().slice(0, 10),
    status,
  });
}

// ---------------------------------------------------------------------------
// Scenario reads
// ---------------------------------------------------------------------------

/** All scenarios owned by the session user. */
export async function getScenarios(token: string | undefined): Promise<Scenario[]> {
  if (!token || !validToken(token)) return [];
  const result = await database().query<ScenarioRow>(
    `SELECT sc.id, sc.user_id, sc.name, sc.created_at, sc.updated_at
       FROM scenarios sc
       JOIN sessions s ON s.user_id = sc.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      ORDER BY sc.created_at ASC`,
    [tokenHash(token)],
  );
  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Single scenario by ID.  Returns null if the scenario does not exist or
 * does not belong to the session user.  Cross-workspace access is impossible
 * because the join through sessions enforces ownership.
 */
export async function getScenario(
  token: string | undefined,
  scenarioId: string,
): Promise<Scenario | null> {
  if (!token || !validToken(token)) return null;
  const result = await database().query<ScenarioRow>(
    `SELECT sc.id, sc.user_id, sc.name, sc.created_at, sc.updated_at
       FROM scenarios sc
       JOIN sessions s ON s.user_id = sc.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sc.id = $2`,
    [tokenHash(token), scenarioId],
  );
  if (!result.rows[0]) return null;
  const r = result.rows[0];
  return { id: r.id, userId: r.user_id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at };
}

// ---------------------------------------------------------------------------
// Adjustment reads
// ---------------------------------------------------------------------------

/**
 * All adjustments for a scenario the session user owns.
 * Includes 'invalid' adjustments so callers can surface them explicitly.
 */
export async function getAdjustments(
  token: string | undefined,
  scenarioId: string,
): Promise<DelayAdjustment[]> {
  if (!token || !validToken(token)) return [];
  // Join through sessions+scenarios to enforce ownership in one query.
  const result = await database().query<AdjustmentRow>(
    `SELECT sa.id, sa.scenario_id, sa.cash_event_id, sa.date_override, sa.status
       FROM scenario_adjustments sa
       JOIN scenarios sc ON sc.id = sa.scenario_id
       JOIN sessions s ON s.user_id = sc.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sa.scenario_id = $2
      ORDER BY sa.created_at ASC`,
    [tokenHash(token), scenarioId],
  );
  return result.rows.map(rowToAdjustment);
}

// ---------------------------------------------------------------------------
// Scenario writes
// ---------------------------------------------------------------------------

/** Create a new named scenario for the session user. */
export async function createScenario(
  token: string | undefined,
  name: string,
): Promise<Scenario> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new RangeError("Scenario name must be 1–200 characters.");
  }
  const result = await database().query<ScenarioRow>(
    `INSERT INTO scenarios (user_id, name)
       SELECT s.user_id, $2
         FROM sessions s
        WHERE s.token_hash = $1 AND s.expires_at > now()
       RETURNING id, user_id, name, created_at, updated_at`,
    [tokenHash(token), trimmed],
  );
  if (result.rowCount !== 1) throw new Error("Authentication required.");
  const r = result.rows[0];
  return { id: r.id, userId: r.user_id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at };
}

// ---------------------------------------------------------------------------
// Adjustment writes
// ---------------------------------------------------------------------------

/**
 * Add a delayed-invoice adjustment to a scenario.
 *
 * Preconditions enforced in SQL:
 *  - The scenario must be owned by the session user.
 *  - The cash event must be owned by the session user.
 *  - A unique constraint prevents two adjustments for the same event in the
 *    same scenario.
 *
 * Returns the persisted DelayAdjustment (status='active').
 * Throws if the scenario or event does not belong to the user.
 */
export async function addDelayAdjustment(
  token: string | undefined,
  scenarioId: string,
  cashEventId: string,
  dateOverride: string, // YYYY-MM-DD
): Promise<DelayAdjustment> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");

  // Verify both the scenario and the event belong to the session user in one
  // query before inserting, so the error is clear rather than a PK/FK violation.
  const ownership = await database().query<{ scenario_ok: boolean; event_ok: boolean }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM scenarios sc
           JOIN sessions s ON s.user_id = sc.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now() AND sc.id = $2
       ) AS scenario_ok,
       EXISTS (
         SELECT 1 FROM cash_events ce
           JOIN sessions s ON s.user_id = ce.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now() AND ce.id = $3
       ) AS event_ok`,
    [tokenHash(token), scenarioId, cashEventId],
  );

  const { scenario_ok, event_ok } = ownership.rows[0];
  if (!scenario_ok) throw new Error("Scenario not found or access denied.");
  if (!event_ok) throw new Error("Cash event not found or access denied.");

  const result = await database().query<AdjustmentRow>(
    `INSERT INTO scenario_adjustments (scenario_id, cash_event_id, date_override)
       VALUES ($1, $2, $3::date)
       RETURNING id, scenario_id, cash_event_id, date_override, status`,
    [scenarioId, cashEventId, dateOverride],
  );
  if (result.rowCount !== 1) throw new Error("Failed to create adjustment.");
  return rowToAdjustment(result.rows[0]);
}

/**
 * Mark an adjustment as 'invalid'.  Called when the target event is deleted
 * so the adjustment remains visible for audit purposes rather than being
 * silently removed.
 *
 * Only the scenario owner can invalidate their own adjustments.
 */
export async function invalidateAdjustment(
  token: string | undefined,
  adjustmentId: string,
): Promise<boolean> {
  if (!token || !validToken(token)) return false;
  const result = await database().query(
    `UPDATE scenario_adjustments sa
        SET status = 'invalid', updated_at = now()
       FROM scenarios sc
       JOIN sessions s ON s.user_id = sc.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sa.scenario_id = sc.id
        AND sa.id = $2`,
    [tokenHash(token), adjustmentId],
  );
  return (result.rowCount ?? 0) > 0;
}
