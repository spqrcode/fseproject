/**
 * Scenario and ScenarioAdjustment persistence.
 *
 * Ownership is always derived from the session token — never from a
 * browser-submitted user or workspace ID. Queries follow the canonical
 * sessions -> workspaces -> scenarios / cash_events ownership chain.
 *
 * An adjustment may be marked status='invalid' when business validation makes
 * it unusable. Hard-deleting the target event removes its adjustment through
 * the database foreign key so account/workspace cleanup cannot be blocked.
 *
 * An adjustment whose event has since been received, paid or cancelled stays
 * 'active' in the table (nothing is written when it is read) but is returned
 * with status 'not_applicable': the event is no longer a forecast event, so
 * the override has nothing to move. The calculation skips it and reports it.
 */

import "server-only";
import { database } from "@/lib/db";
import { hasValidSession, tokenHash, validToken } from "@/lib/session-store";
import type { DelayAdjustment } from "@/lib/forecast/scenario";
import { isoDateSchema, scenarioNameSchema, uuidSchema } from "@/lib/validation";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ScenarioRow {
  id: string;
  workspace_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

interface AdjustmentRow {
  id: string;
  scenario_id: string;
  cash_event_id: string;
  date_override: string;
  status: string;
}

export type Scenario = {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export class DuplicateDelayAdjustmentError extends Error {
  constructor() {
    super("This cash event already has a delay adjustment in this scenario.");
  }
}

function postgresCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

function rowToAdjustment(row: AdjustmentRow): DelayAdjustment {
  const status = row.status === "active" || row.status === "invalid" || row.status === "not_applicable" ? row.status : "invalid";
  return Object.freeze({
    id: row.id,
    scenarioId: row.scenario_id,
    cashEventId: row.cash_event_id,
    dateOverride: row.date_override,
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
    `SELECT sc.id, sc.workspace_id, sc.name, sc.created_at, sc.updated_at
       FROM scenarios sc
       JOIN workspaces w ON w.id = sc.workspace_id
       JOIN sessions s ON s.user_id = w.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      ORDER BY sc.created_at ASC`,
    [tokenHash(token)],
  );
  return result.rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
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
  scenarioId: unknown,
): Promise<Scenario | null> {
  if (!token || !validToken(token)) return null;
  const id = uuidSchema.safeParse(scenarioId);
  if (!id.success) return null;
  const result = await database().query<ScenarioRow>(
    `SELECT sc.id, sc.workspace_id, sc.name, sc.created_at, sc.updated_at
       FROM scenarios sc
       JOIN workspaces w ON w.id = sc.workspace_id
       JOIN sessions s ON s.user_id = w.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sc.id = $2`,
    [tokenHash(token), id.data],
  );
  if (!result.rows[0]) return null;
  const r = result.rows[0];
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at };
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
  scenarioId: unknown,
): Promise<DelayAdjustment[]> {
  if (!token || !validToken(token)) return [];
  const id = uuidSchema.safeParse(scenarioId);
  if (!id.success) return [];
  // Join through sessions+scenarios to enforce ownership in one query.
  const result = await database().query<AdjustmentRow>(
    `SELECT sa.id, sa.scenario_id, sa.cash_event_id,
            sa.date_override::text AS date_override,
            CASE WHEN sa.status = 'active' AND ce.status <> 'expected' THEN 'not_applicable'
                 ELSE sa.status END AS status
       FROM scenario_adjustments sa
       JOIN scenarios sc ON sc.id = sa.scenario_id
       JOIN cash_events ce ON ce.id = sa.cash_event_id AND ce.workspace_id = sa.workspace_id
       JOIN workspaces w ON w.id = sc.workspace_id
       JOIN sessions s ON s.user_id = w.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sa.scenario_id = $2
      ORDER BY sa.created_at ASC`,
    [tokenHash(token), id.data],
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
  const scenarioName = scenarioNameSchema.parse(name);
  const result = await database().query<ScenarioRow>(
    `INSERT INTO scenarios (workspace_id, name)
       SELECT w.id, $2
         FROM sessions s
         JOIN workspaces w ON w.user_id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
       RETURNING id, workspace_id, name, created_at, updated_at`,
    [tokenHash(token), scenarioName],
  );
  if (result.rowCount !== 1) {
    if (!await hasValidSession(token)) throw new Error("Authentication required.");
    throw new Error("Create a workspace before creating a scenario.");
  }
  const r = result.rows[0];
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at };
}

// ---------------------------------------------------------------------------
// Adjustment writes
// ---------------------------------------------------------------------------

/**
 * Add a delayed-invoice adjustment to a scenario.
 *
 * Preconditions enforced atomically in SQL:
 *  - The scenario and cash event must belong to the session user's workspace.
 *  - The cash event must be an expected income event.
 *  - The override must be later than the original event date.
 *  - A unique constraint prevents two adjustments for the same event in the
 *    same scenario.
 *
 * Returns the persisted DelayAdjustment (status='active').
 * Throws if the scenario or event does not belong to the user.
 */
export async function addDelayAdjustment(
  token: string | undefined,
  scenarioId: unknown,
  cashEventId: unknown,
  dateOverride: string, // YYYY-MM-DD
): Promise<DelayAdjustment> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const scenario = uuidSchema.safeParse(scenarioId);
  if (!scenario.success) throw new Error("Scenario not found or access denied.");
  const event = uuidSchema.safeParse(cashEventId);
  if (!event.success) throw new Error("Cash event not found or access denied.");
  const override = isoDateSchema.parse(dateOverride);

  let result;
  try {
    result = await database().query<AdjustmentRow>(
      `INSERT INTO scenario_adjustments (workspace_id, scenario_id, cash_event_id, date_override)
         SELECT sc.workspace_id, sc.id, ce.id, $4::date
           FROM sessions s
           JOIN workspaces w ON w.user_id = s.user_id
           JOIN scenarios sc ON sc.workspace_id = w.id AND sc.id = $2
           JOIN cash_events ce ON ce.workspace_id = w.id AND ce.id = $3
          WHERE s.token_hash = $1 AND s.expires_at > now()
            AND ce.status = 'expected' AND ce.amount > 0
            AND $4::date > ce.expected_date
         RETURNING id, scenario_id, cash_event_id,
                   date_override::text AS date_override, status`,
      [tokenHash(token), scenario.data, event.data, override],
    );
  } catch (error) {
    if (postgresCode(error) === "23505") throw new DuplicateDelayAdjustmentError();
    throw error;
  }
  if (result.rowCount !== 1) {
    if (!await hasValidSession(token)) throw new Error("Authentication required.");
    throw new Error(
      "A delay adjustment requires an owned scenario and an expected income event with a later date.",
    );
  }
  return rowToAdjustment(result.rows[0]);
}

/**
 * Mark an adjustment as 'invalid' while retaining it for audit purposes.
 *
 * Only the scenario owner can invalidate their own adjustments.
 */
export async function invalidateAdjustment(
  token: string | undefined,
  adjustmentId: unknown,
): Promise<boolean> {
  if (!token || !validToken(token)) return false;
  const id = uuidSchema.safeParse(adjustmentId);
  if (!id.success) return false;
  const result = await database().query(
    `UPDATE scenario_adjustments sa
        SET status = 'invalid', updated_at = now()
       FROM scenarios sc
       JOIN workspaces w ON w.id = sc.workspace_id
       JOIN sessions s ON s.user_id = w.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND sa.scenario_id = sc.id
        AND sa.id = $2`,
    [tokenHash(token), id.data],
  );
  return (result.rowCount ?? 0) > 0;
}
