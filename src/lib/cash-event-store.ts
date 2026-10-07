/**
 * Cash-event persistence.
 *
 * All queries enforce ownership through the sessions table exactly the same
 * way portfolio-store.ts does: the session token is joined to the user row;
 * there is no browser-submitted user ID.
 *
 * NUMERIC(19,4) values come back from pg as strings when the pg option
 * `types.setTypeParser` is not configured for OID 1700 (numeric).  We keep
 * them as strings and pass them straight into the domain layer where
 * parseDecimal validates them.
 */

import "server-only";
import { database } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/session-store";
import { parseCashEvent, type CashEvent } from "@/lib/forecast/cash-event";
import { uuidSchema } from "@/lib/validation";

// ---------------------------------------------------------------------------
// Types matching the DB row columns
// ---------------------------------------------------------------------------

interface CashEventRow {
  id: string;
  user_id: string;
  description: string;
  amount: string;
  currency: string;
  expected_date: string;
}

function rowToEvent(row: CashEventRow): CashEvent {
  return parseCashEvent({
    id: row.id,
    userId: row.user_id,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    expectedDate: row.expected_date,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Return all cash events for the authenticated user, ordered by date then id. */
export async function getCashEvents(token: string | undefined): Promise<CashEvent[]> {
  if (!token || !validToken(token)) return [];
  const result = await database().query<CashEventRow>(
    `SELECT ce.id, ce.user_id, ce.description, ce.amount::text, ce.currency,
            ce.expected_date::text AS expected_date
       FROM cash_events ce
       JOIN sessions s ON s.user_id = ce.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      ORDER BY ce.expected_date ASC, ce.id ASC`,
    [tokenHash(token)],
  );
  return result.rows.map(rowToEvent);
}

/** Return a single cash event, or null if it does not belong to the session owner. */
export async function getCashEvent(
  token: string | undefined,
  eventId: unknown,
): Promise<CashEvent | null> {
  if (!token || !validToken(token)) return null;
  const id = uuidSchema.safeParse(eventId);
  if (!id.success) return null;
  const result = await database().query<CashEventRow>(
    `SELECT ce.id, ce.user_id, ce.description, ce.amount::text, ce.currency,
            ce.expected_date::text AS expected_date
       FROM cash_events ce
       JOIN sessions s ON s.user_id = ce.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND ce.id = $2`,
    [tokenHash(token), id.data],
  );
  return result.rows[0] ? rowToEvent(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateCashEventInput {
  description: string;
  /** Signed decimal string. Positive = income, negative = expense. */
  amount: string;
  currency: string;
  /** YYYY-MM-DD */
  expectedDate: string;
}

/**
 * Insert a new cash event for the session owner.
 * The domain layer validates the event before insertion; if validation
 * fails the database is never touched.
 */
export async function createCashEvent(
  token: string | undefined,
  input: CreateCashEventInput,
): Promise<CashEvent> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");

  // Validate via the domain layer first (zero-amount check, currency, date).
  // We use a placeholder UUID so parseCashEvent can validate the rest.
  const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
  parseCashEvent({
    id: PLACEHOLDER_ID,
    userId: PLACEHOLDER_ID,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    expectedDate: input.expectedDate,
  });

  const result = await database().query<CashEventRow>(
    `INSERT INTO cash_events (user_id, description, amount, currency, expected_date)
       SELECT s.user_id, $2, $3::numeric, $4, $5::date
         FROM sessions s
        WHERE s.token_hash = $1 AND s.expires_at > now()
       RETURNING id, user_id, description, amount::text, currency,
                 expected_date::text AS expected_date`,
    [tokenHash(token), input.description, input.amount, input.currency, input.expectedDate],
  );
  if (result.rowCount !== 1) throw new Error("Authentication required.");
  return rowToEvent(result.rows[0]);
}

/**
 * Delete a cash event owned by the session user.
 *
 * Scenario adjustments are deleted by the database when their target event
 * is hard-deleted. Normal user-facing cancellation is represented by event
 * status in the canonical cash-event schema; hard deletion remains safe for
 * account and workspace cleanup.
 *
 * Returns true if the row was deleted, false if it was not found or
 * does not belong to the session user.
 */
export async function deleteCashEvent(
  token: string | undefined,
  eventId: unknown,
): Promise<boolean> {
  if (!token || !validToken(token)) return false;
  const id = uuidSchema.safeParse(eventId);
  if (!id.success) return false;
  const result = await database().query(
    `DELETE FROM cash_events
      WHERE id = $2
        AND user_id = (
          SELECT user_id FROM sessions
           WHERE token_hash = $1 AND expires_at > now()
        )`,
    [tokenHash(token), id.data],
  );
  return (result.rowCount ?? 0) > 0;
}
