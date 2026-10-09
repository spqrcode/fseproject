/**
 * FX snapshot DB persistence.
 *
 * Stores validated ECB rates as snapshot rows. Duplicate fetches for the same
 * (provider, base, quote, effective_date) refresh that row idempotently. A
 * complete provider response is persisted in one SQL statement, so USD and
 * SGD cannot be partially written.
 *
 * Ownership: FX rates are global (not user-scoped).  The snapshot table has
 * no user_id column.  Only server-side code in trusted modules may write to it.
 */

import "server-only";
import { database } from "@/lib/db";
import { decimalString, parseDecimal } from "@/lib/forecast/decimal";
import type { ParsedEcbRate } from "@/lib/fx/ecb-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}>;

// DB row shape returned by pg
interface SnapshotRow {
  id: string;
  provider: string;
  base_currency: string;
  quote_currency: string;
  rate: string;        // pg returns NUMERIC as string
  effective_date: string;
  fetched_at: Date;
}

function rowToSnapshot(row: SnapshotRow): FxSnapshot {
  return Object.freeze({
    id: row.id,
    provider: row.provider,
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: decimalString(parseDecimal(row.rate)),
    effectiveDate: row.effective_date,
    fetchedAt: row.fetched_at,
  });
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Persist validated ECB rates. If a snapshot for the same provider, pair and
 * effective date exists, a newer fetch may refresh its rate and fetched_at.
 * An older response arriving late cannot overwrite a newer one.
 */
export async function upsertSnapshots(
  provider: string,
  rates: readonly ParsedEcbRate[],
  fetchedAt: Date,
): Promise<readonly FxSnapshot[]> {
  if (rates.length === 0) return [];
  const payload = rates.map((rate) => ({
    base_currency: rate.baseCurrency,
    quote_currency: rate.quoteCurrency,
    rate: rate.rate,
    effective_date: rate.effectiveDate,
  }));
  const result = await database().query<SnapshotRow>(
    `INSERT INTO fx_snapshots
       (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
     SELECT $1, input.base_currency, input.quote_currency,
            input.rate::numeric, input.effective_date::date, $3
       FROM jsonb_to_recordset($2::jsonb) AS input(
         base_currency text,
         quote_currency text,
         rate text,
         effective_date text
       )
     ON CONFLICT ON CONSTRAINT fx_snapshots_unique_rate
     DO UPDATE SET
       rate = CASE
         WHEN EXCLUDED.fetched_at >= fx_snapshots.fetched_at THEN EXCLUDED.rate
         ELSE fx_snapshots.rate
       END,
       fetched_at = GREATEST(fx_snapshots.fetched_at, EXCLUDED.fetched_at)
     RETURNING id, provider, base_currency, quote_currency,
               rate::text, effective_date::text AS effective_date, fetched_at`,
    [provider, JSON.stringify(payload), fetchedAt],
  );
  return result.rows.map(rowToSnapshot);
}

/** Persist one validated rate; useful for focused store operations and tests. */
export async function upsertSnapshot(
  provider: string,
  rate: ParsedEcbRate,
  fetchedAt: Date,
): Promise<FxSnapshot> {
  const snapshots = await upsertSnapshots(provider, [rate], fetchedAt);
  return snapshots[0];
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Return the most recently fetched snapshot for a given
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
            rate::text, effective_date::text AS effective_date, fetched_at
       FROM fx_snapshots
      WHERE provider       = $1
        AND base_currency  = $2
        AND quote_currency = $3
        AND fetched_at    >= $4
      ORDER BY fetched_at DESC
      LIMIT 1`,
    [provider, baseCurrency, quoteCurrency, cutoff],
  );
  return result.rows[0] ? rowToSnapshot(result.rows[0]) : null;
}

/**
 * Return the newest validated snapshot regardless of age.
 * Used as the STALE fallback when a fresh fetch fails.
 */
export async function findLatestSnapshot(
  provider: string,
  baseCurrency: string,
  quoteCurrency: string,
): Promise<FxSnapshot | null> {
  const result = await database().query<SnapshotRow>(
    `SELECT id, provider, base_currency, quote_currency,
            rate::text, effective_date::text AS effective_date, fetched_at
       FROM fx_snapshots
      WHERE provider       = $1
        AND base_currency  = $2
        AND quote_currency = $3
      ORDER BY fetched_at DESC
      LIMIT 1`,
    [provider, baseCurrency, quoteCurrency],
  );
  return result.rows[0] ? rowToSnapshot(result.rows[0]) : null;
}
