/**
 * FX snapshot DB persistence.
 *
 * Stores parsed ECB rates as immutable snapshot rows.  Duplicate fetches for
 * the same (provider, base, quote, effective_date) are idempotent via
 * ON CONFLICT DO NOTHING.
 *
 * Ownership: FX rates are global (not user-scoped).  The snapshot table has
 * no user_id column.  Only server-side code in trusted modules may write to it.
 */

import "server-only";
import { database } from "@/lib/db";
import type { ParsedEcbRate } from "@/lib/fx/ecb-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapshotState = "accepted" | "rejected";

export type FxSnapshot = Readonly<{
  id: string;
  provider: string;
  baseCurrency: string;
  quoteCurrency: string;
  /** Decimal string; never zero or negative. */
  rate: string;
  /** YYYY-MM-DD ECB effective date. */
  effectiveDate: string;
  fetchedAt: Date;
  state: SnapshotState;
  rejectionReason: string | null;
}>;

// DB row shape returned by pg
interface SnapshotRow {
  id: string;
  provider: string;
  base_currency: string;
  quote_currency: string;
  rate: string;        // pg returns NUMERIC as string
  effective_date: string | Date;
  fetched_at: Date;
  state: string;
  rejection_reason: string | null;
}

function rowToSnapshot(row: SnapshotRow): FxSnapshot {
  const effectiveDate =
    typeof row.effective_date === "string"
      ? row.effective_date.slice(0, 10)
      : row.effective_date instanceof Date
        ? row.effective_date.toISOString().slice(0, 10)
        : String(row.effective_date).slice(0, 10);

  return Object.freeze({
    id: row.id,
    provider: row.provider,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: row.rate,
    effectiveDate,
    fetchedAt: row.fetched_at,
    state: (row.state === "accepted" || row.state === "rejected")
      ? row.state
      : "rejected",
    rejectionReason: row.rejection_reason,
  });
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Persist a validated ECB rate.  If a snapshot for the same
 * (provider, base, quote, effective_date) already exists, the insert
 * is skipped and the existing row is updated with the new fetched_at (idempotent).
 */
export async function upsertSnapshot(
  provider: string,
  rate: ParsedEcbRate,
  fetchedAt: Date,
): Promise<FxSnapshot> {
  const result = await database().query<SnapshotRow>(
    `INSERT INTO fx_snapshots
       (provider, base_currency, quote_currency, rate, effective_date, fetched_at, state)
     VALUES ($1, $2, $3, $4::numeric, $5::date, $6, 'accepted')
     ON CONFLICT ON CONSTRAINT fx_snapshots_unique_rate
     DO UPDATE SET fetched_at = EXCLUDED.fetched_at
     RETURNING id, provider, base_currency, quote_currency,
               rate::text, effective_date::text AS effective_date, fetched_at, state, rejection_reason`,
    [
      provider,
      rate.baseCurrency,
      rate.quoteCurrency,
      rate.rate,
      rate.effectiveDate,
      fetchedAt,
    ],
  );
  return rowToSnapshot(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Return the most recently fetched accepted snapshot for a given
 * (provider, base, quote) pair that was fetched within `maxAgeMs`.
 *
 * "Recently fetched" is defined by the `fetched_at` column so that even a
 * weekend rate (same effective_date as yesterday) is considered fresh if it
 * was fetched within the cache window.
 */
export async function findRecentSnapshot(
  provider: string,
  baseCurrency: string,
  quoteCurrency: string,
  maxAgeMs: number,
): Promise<FxSnapshot | null> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await database().query<SnapshotRow>(
    `SELECT id, provider, base_currency, quote_currency,
            rate::text, effective_date::text AS effective_date, fetched_at, state, rejection_reason
       FROM fx_snapshots
      WHERE provider       = $1
        AND base_currency  = $2
        AND quote_currency = $3
        AND state          = 'accepted'
        AND fetched_at    >= $4
      ORDER BY fetched_at DESC
      LIMIT 1`,
    [provider, baseCurrency, quoteCurrency, cutoff],
  );
  return result.rows[0] ? rowToSnapshot(result.rows[0]) : null;
}

/**
 * Return the newest accepted snapshot regardless of age.
 * Used as the STALE fallback when a fresh fetch fails.
 */
export async function findLatestSnapshot(
  provider: string,
  baseCurrency: string,
  quoteCurrency: string,
): Promise<FxSnapshot | null> {
  const result = await database().query<SnapshotRow>(
    `SELECT id, provider, base_currency, quote_currency,
            rate::text, effective_date::text AS effective_date, fetched_at, state, rejection_reason
       FROM fx_snapshots
      WHERE provider       = $1
        AND base_currency  = $2
        AND quote_currency = $3
        AND state          = 'accepted'
      ORDER BY fetched_at DESC
      LIMIT 1`,
    [provider, baseCurrency, quoteCurrency],
  );
  return result.rows[0] ? rowToSnapshot(result.rows[0]) : null;
}
