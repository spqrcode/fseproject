/**
 * FX rate service — cache, refresh, and cross-rate derivation.
 *
 * Financial rules:
 *  - ECB is the authoritative source.  The DB snapshot cache is the durable store.
 *  - A snapshot fetched within CACHE_TTL_MS is CURRENT; skip the network call.
 *  - A snapshot older than CACHE_TTL_MS triggers a refresh attempt.
 *  - If refresh succeeds → persist → return CURRENT.
 *  - If refresh fails and any accepted snapshot exists → return STALE with its
 *    effective_date and fetched_at.
 *  - If no accepted snapshot exists → return UNAVAILABLE.
 *  - Rates are NEVER hard-coded or fabricated.
 *  - Cross-rates: USD/SGD = ECB_SGD / ECB_USD (and vice versa).
 *    Missing either leg → UNAVAILABLE for that pair.
 *  - Rounding is not applied here; the caller rounds at display time.
 *
 * This module is server-only (imports snapshot-store and ecb-provider).
 */

import "server-only";
import { parseDecimal, decimalString } from "@/lib/forecast/decimal";
import { fxRate, FxRateError, type FxRate } from "@/lib/forecast/fx";
import { parseEcbCsv, deriveEcbCrossRate } from "@/lib/fx/ecb-parser";
import {
  upsertSnapshot,
  findRecentSnapshot,
  findLatestSnapshot,
  type FxSnapshot,
} from "@/lib/fx/snapshot-store";
import { liveEcbProvider, type EcbProvider, type EcbFetchResult } from "@/lib/fx/ecb-provider";
import type { Currency } from "@/lib/forecast/money";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Provider key stored in the DB. */
export const ECB_PROVIDER = "ecb";

/**
 * If a snapshot was fetched within this window, serve it as CURRENT without
 * calling the ECB API.  60 minutes is conservative — ECB publishes once daily
 * around 16:00 CET.
 */
export const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RateStatus = "CURRENT" | "STALE" | "UNAVAILABLE";

export type RateResult =
  | {
      status: "CURRENT" | "STALE";
      rate: FxRate;
      effectiveDate: string;
      fetchedAt: Date;
    }
  | { status: "UNAVAILABLE" };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function snapshotToFxRate(snapshot: FxSnapshot): FxRate {
  return fxRate(
    snapshot.baseCurrency as Currency,
    snapshot.quoteCurrency as Currency,
    snapshot.rate,
  );
}

/**
 * Build a RateResult from an existing snapshot.
 * `status` determines whether this is CURRENT (cache hit or fresh fetch) or STALE.
 */
function snapshotToResult(
  snapshot: FxSnapshot,
  status: "CURRENT" | "STALE",
): RateResult {
  return {
    status,
    rate: snapshotToFxRate(snapshot),
    effectiveDate: snapshot.effectiveDate,
    fetchedAt: snapshot.fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Core service
// ---------------------------------------------------------------------------

/**
 * Get the EUR/USD or EUR/SGD rate.
 *
 * Fetches from the ECB if no fresh snapshot exists; falls back to a stale
 * snapshot on failure; returns UNAVAILABLE if no snapshot exists at all.
 *
 * @param quoteCurrency - 'USD' or 'SGD'
 * @param provider      - Injected provider (defaults to the live ECB adapter).
 *                        Tests pass a mock here.
 */
export async function getEurRate(
  quoteCurrency: "USD" | "SGD",
  provider: EcbProvider = liveEcbProvider,
): Promise<RateResult> {
  const BASE = "EUR";

  // 1. Check the cache.
  const cached = await findRecentSnapshot(ECB_PROVIDER, BASE, quoteCurrency, CACHE_TTL_MS);
  if (cached) return snapshotToResult(cached, "CURRENT");

  // 2. Try to refresh from the provider.
  let fetched: EcbFetchResult;
  try {
    fetched = await provider.fetchRates();
  } catch (err) {
    fetched = {
      ok: false,
      reason: err instanceof Error ? err.message : "Provider failure",
      fetchedAt: new Date(),
    };
  }

  if (fetched.ok) {
    const parsed = parseEcbCsv(fetched.csv);
    if (parsed.ok) {
      let wantedSnapshot: FxSnapshot | null = null;
      for (const r of parsed.rates) {
        const snap = await upsertSnapshot(ECB_PROVIDER, r, fetched.fetchedAt);
        if (r.quoteCurrency === quoteCurrency) {
          wantedSnapshot = snap;
        }
      }
      if (wantedSnapshot) return snapshotToResult(wantedSnapshot, "CURRENT");
    }
  }

  // 3. Refresh failed — try the most recent snapshot of any age (STALE).
  const stale = await findLatestSnapshot(ECB_PROVIDER, BASE, quoteCurrency);
  if (stale) return snapshotToResult(stale, "STALE");

  // 4. Nothing available.
  return { status: "UNAVAILABLE" };
}

/**
 * Get a cross-rate between two non-EUR currencies (USD ↔ SGD).
 *
 * Both legs must be CURRENT or STALE for a result to be returned.
 * If either leg is UNAVAILABLE, the whole result is UNAVAILABLE.
 * Status is STALE if either leg is STALE.
 */
export async function getCrossRate(
  from: "USD" | "SGD",
  to: "USD" | "SGD",
  provider: EcbProvider = liveEcbProvider,
): Promise<RateResult> {
  if (from === to) {
    throw new FxRateError("An FX rate must contain two different currencies.");
  }

  const fromResult = await getEurRate(from, provider);
  const toResult = await getEurRate(to, provider);

  if (fromResult.status === "UNAVAILABLE" || toResult.status === "UNAVAILABLE") {
    return { status: "UNAVAILABLE" };
  }

  // cross = toRate / fromRate (units of `to` per 1 `from`)
  // ECB rates: EUR/from and EUR/to
  // X -> Y = ECB_Y / ECB_X
  const fromEcbRate = parseDecimal(fromResult.rate.rate);
  const toEcbRate = parseDecimal(toResult.rate.rate);
  const crossRateValue = decimalString(toEcbRate.dividedBy(fromEcbRate));

  const status: "CURRENT" | "STALE" =
    fromResult.status === "STALE" || toResult.status === "STALE" ? "STALE" : "CURRENT";

  // Use the older of the two effective dates (more conservative)
  const effectiveDate =
    fromResult.effectiveDate < toResult.effectiveDate
      ? fromResult.effectiveDate
      : toResult.effectiveDate;

  // Use the older of the two fetched_at timestamps
  const fetchedAt =
    fromResult.fetchedAt < toResult.fetchedAt
      ? fromResult.fetchedAt
      : toResult.fetchedAt;

  return {
    status,
    rate: fxRate(from, to, crossRateValue),
    effectiveDate,
    fetchedAt,
  };
}

/**
 * Convenience: get any supported rate pair.
 *
 * Supported pairs:
 *   EUR/USD, EUR/SGD  — direct ECB rates
 *   USD/EUR, SGD/EUR  — reciprocal rates (1 / ECB_rate)
 *   USD/SGD, SGD/USD  — derived cross-rates
 */
export async function getRate(
  base: Currency,
  quote: Currency,
  provider: EcbProvider = liveEcbProvider,
): Promise<RateResult> {
  if (base === quote) {
    throw new FxRateError("An FX rate must contain two different currencies.");
  }

  // Direct ECB rates: EUR is the base
  if (base === "EUR" && (quote === "USD" || quote === "SGD")) {
    return getEurRate(quote, provider);
  }

  // Reciprocal rates where EUR is the quote
  if (quote === "EUR" && (base === "USD" || base === "SGD")) {
    const eurBase = await getEurRate(base, provider);
    if (eurBase.status === "UNAVAILABLE") return eurBase;
    const invRate = decimalString(parseDecimal("1").dividedBy(parseDecimal(eurBase.rate.rate)));
    return {
      ...eurBase,
      rate: fxRate(base, quote, invRate),
    };
  }

  // Cross-rates between USD and SGD
  if (
    (base === "USD" && quote === "SGD") ||
    (base === "SGD" && quote === "USD")
  ) {
    return getCrossRate(base, quote, provider);
  }

  // Any other combination is unsupported
  return { status: "UNAVAILABLE" };
}

// ---------------------------------------------------------------------------
// Bulk helper for forecast use
// ---------------------------------------------------------------------------

/**
 * Fetch both EUR/USD and EUR/SGD together.
 * Sequential execution ensures that the first call populates the DB cache with
 * both rates, avoiding a duplicate provider call on the second rate.
 * Returns a map of quoteCurrency → RateResult.
 */
export async function getAllEcbRates(
  provider: EcbProvider = liveEcbProvider,
): Promise<{ USD: RateResult; SGD: RateResult }> {
  const usd = await getEurRate("USD", provider);
  const sgd = await getEurRate("SGD", provider);
  return { USD: usd, SGD: sgd };
}

// Re-export deriveEcbCrossRate and FxRateError for consumers
export { deriveEcbCrossRate, FxRateError };
