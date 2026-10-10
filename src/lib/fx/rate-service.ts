/**
 * FX rate service — durable cache, refresh fallback and cross-rate derivation.
 *
 * ECB is the only source. Fresh cached snapshots avoid a network call. A failed
 * refresh may return an explicitly STALE snapshot, but a missing rate is never
 * replaced with zero or a fabricated number. Calculations retain Decimal
 * precision; presentation rounding belongs at the UI boundary.
 */

import "server-only";
import { parseDecimal, decimalString } from "@/lib/forecast/decimal";
import { fxRate, FxRateError, type FxRate } from "@/lib/forecast/fx";
import { deriveEcbCrossRate, parseEcbCsv } from "@/lib/fx/ecb-parser";
import {
  findLatestSnapshot,
  findRecentSnapshot,
  upsertSnapshots,
  type FxSnapshot,
} from "@/lib/fx/snapshot-store";
import { liveEcbProvider, type EcbProvider } from "@/lib/fx/ecb-provider";
import type { Currency } from "@/lib/forecast/money";

export const ECB_PROVIDER = "ecb";
export const CACHE_TTL_MS = 60 * 60 * 1_000;

export type RateStatus = "CURRENT" | "STALE" | "UNAVAILABLE";
export type RateFailureCode =
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "PERSISTENCE_ERROR"
  | "MISSING_RATE"
  | "MISMATCHED_EFFECTIVE_DATE"
  | "UNSUPPORTED_PAIR";

export type RateFailure = Readonly<{
  code: RateFailureCode;
  /** Fixed UI-safe text. Raw provider/database details stay in server logs. */
  message: string;
}>;

export type RateResult =
  | Readonly<{
      status: "CURRENT" | "STALE";
      rate: FxRate;
      provider: string;
      snapshotIds: readonly string[];
      effectiveDate: string;
      fetchedAt: Date;
      /** Why a refresh failed when a cached STALE value is returned. */
      refreshFailure: RateFailure | null;
    }>
  | Readonly<{
      status: "UNAVAILABLE";
      rate: null;
      provider: string;
      snapshotIds: readonly [];
      effectiveDate: null;
      fetchedAt: null;
      failure: RateFailure;
    }>;

type RefreshResult =
  | { ok: true; snapshots: readonly FxSnapshot[] }
  | { ok: false; failure: RateFailure };

const FAILURE_MESSAGES: Readonly<Record<RateFailureCode, string>> = Object.freeze({
  PROVIDER_ERROR: "Exchange rates are temporarily unavailable.",
  INVALID_RESPONSE: "The exchange-rate provider returned invalid data.",
  PERSISTENCE_ERROR: "Exchange rates could not be cached.",
  MISSING_RATE: "A required exchange rate is missing.",
  MISMATCHED_EFFECTIVE_DATE: "The required rates do not share an effective date.",
  UNSUPPORTED_PAIR: "This currency pair is not supported.",
});

function rateFailure(code: RateFailureCode): RateFailure {
  return Object.freeze({ code, message: FAILURE_MESSAGES[code] });
}

function unavailable(failure: RateFailure): RateResult {
  return Object.freeze({
    status: "UNAVAILABLE",
    rate: null,
    provider: ECB_PROVIDER,
    snapshotIds: Object.freeze([]) as readonly [],
    effectiveDate: null,
    fetchedAt: null,
    failure,
  });
}

function snapshotToResult(
  snapshot: FxSnapshot,
  status: "CURRENT" | "STALE",
  refreshFailure: RateFailure | null = null,
): RateResult {
  return Object.freeze({
    status,
    rate: fxRate(
      snapshot.baseCurrency as Currency,
      snapshot.quoteCurrency as Currency,
      snapshot.rate,
    ),
    provider: snapshot.provider,
    snapshotIds: Object.freeze([snapshot.id]),
    effectiveDate: snapshot.effectiveDate,
    fetchedAt: snapshot.fetchedAt,
    refreshFailure,
  });
}

async function refreshEcbSnapshots(provider: EcbProvider): Promise<RefreshResult> {
  let fetched;
  try {
    fetched = await provider.fetchRates();
  } catch (error) {
    console.error("ECB provider threw unexpectedly.", error);
    return {
      ok: false,
      failure: rateFailure("PROVIDER_ERROR"),
    };
  }

  if (!fetched.ok) {
    console.error("ECB provider reported a failure.", fetched.reason);
    return {
      ok: false,
      failure: rateFailure("PROVIDER_ERROR"),
    };
  }

  const parsed = parseEcbCsv(fetched.csv);
  if (!parsed.ok) {
    console.error("ECB response validation failed.", parsed.reason);
    return {
      ok: false,
      failure: rateFailure("INVALID_RESPONSE"),
    };
  }

  try {
    return {
      ok: true,
      snapshots: await upsertSnapshots(ECB_PROVIDER, parsed.rates, fetched.fetchedAt),
    };
  } catch (error) {
    console.error("Validated ECB rates could not be stored.", error);
    return {
      ok: false,
      failure: rateFailure("PERSISTENCE_ERROR"),
    };
  }
}

async function staleOrUnavailable(
  quoteCurrency: "USD" | "SGD",
  failure: RateFailure,
): Promise<RateResult> {
  const stale = await findLatestSnapshot(ECB_PROVIDER, "EUR", quoteCurrency);
  return stale
    ? snapshotToResult(stale, "STALE", failure)
    : unavailable(failure);
}

export async function getEurRate(
  quoteCurrency: "USD" | "SGD",
  provider: EcbProvider = liveEcbProvider,
): Promise<RateResult> {
  const cached = await findRecentSnapshot(
    ECB_PROVIDER,
    "EUR",
    quoteCurrency,
    CACHE_TTL_MS,
  );
  if (cached) return snapshotToResult(cached, "CURRENT");

  const refreshed = await refreshEcbSnapshots(provider);
  if (refreshed.ok) {
    const wanted = refreshed.snapshots.find(
      (snapshot) => snapshot.quoteCurrency === quoteCurrency,
    );
    if (wanted) return snapshotToResult(wanted, "CURRENT");
    return staleOrUnavailable(
      quoteCurrency,
      rateFailure("MISSING_RATE"),
    );
  }
  return staleOrUnavailable(quoteCurrency, refreshed.failure);
}

/**
 * Resolve both direct ECB legs with at most one provider request. This is used
 * by cross-rate calculations so a provider outage cannot cause two retries.
 */
export async function getAllEcbRates(
  provider: EcbProvider = liveEcbProvider,
): Promise<{ USD: RateResult; SGD: RateResult }> {
  const [cachedUsd, cachedSgd] = await Promise.all([
    findRecentSnapshot(ECB_PROVIDER, "EUR", "USD", CACHE_TTL_MS),
    findRecentSnapshot(ECB_PROVIDER, "EUR", "SGD", CACHE_TTL_MS),
  ]);
  if (cachedUsd && cachedSgd) {
    return {
      USD: snapshotToResult(cachedUsd, "CURRENT"),
      SGD: snapshotToResult(cachedSgd, "CURRENT"),
    };
  }

  const refreshed = await refreshEcbSnapshots(provider);
  if (refreshed.ok) {
    const usd = refreshed.snapshots.find((snapshot) => snapshot.quoteCurrency === "USD");
    const sgd = refreshed.snapshots.find((snapshot) => snapshot.quoteCurrency === "SGD");
    if (usd && sgd) {
      return {
        USD: snapshotToResult(usd, "CURRENT"),
        SGD: snapshotToResult(sgd, "CURRENT"),
      };
    }
    const failure = rateFailure("MISSING_RATE");
    return {
      USD: cachedUsd
        ? snapshotToResult(cachedUsd, "CURRENT")
        : await staleOrUnavailable("USD", failure),
      SGD: cachedSgd
        ? snapshotToResult(cachedSgd, "CURRENT")
        : await staleOrUnavailable("SGD", failure),
    };
  }

  return {
    USD: cachedUsd
      ? snapshotToResult(cachedUsd, "CURRENT")
      : await staleOrUnavailable("USD", refreshed.failure),
    SGD: cachedSgd
      ? snapshotToResult(cachedSgd, "CURRENT")
      : await staleOrUnavailable("SGD", refreshed.failure),
  };
}

export async function getCrossRate(
  from: "USD" | "SGD",
  to: "USD" | "SGD",
  provider: EcbProvider = liveEcbProvider,
): Promise<RateResult> {
  if (from === to) {
    throw new FxRateError("An FX rate must contain two different currencies.");
  }

  const rates = await getAllEcbRates(provider);
  const fromResult = rates[from];
  const toResult = rates[to];
  if (fromResult.status === "UNAVAILABLE") return fromResult;
  if (toResult.status === "UNAVAILABLE") return toResult;
  if (fromResult.effectiveDate !== toResult.effectiveDate) {
    return unavailable(rateFailure("MISMATCHED_EFFECTIVE_DATE"));
  }

  const crossRateValue = decimalString(
    parseDecimal(toResult.rate.rate).dividedBy(parseDecimal(fromResult.rate.rate)),
  );
  const status = fromResult.status === "STALE" || toResult.status === "STALE"
    ? "STALE"
    : "CURRENT";
  const fetchedAt = fromResult.fetchedAt < toResult.fetchedAt
    ? fromResult.fetchedAt
    : toResult.fetchedAt;

  return Object.freeze({
    status,
    rate: fxRate(from, to, crossRateValue),
    provider: ECB_PROVIDER,
    snapshotIds: Object.freeze([
      ...new Set([...fromResult.snapshotIds, ...toResult.snapshotIds]),
    ]),
    effectiveDate: fromResult.effectiveDate,
    fetchedAt,
    refreshFailure: fromResult.refreshFailure ?? toResult.refreshFailure,
  });
}

export async function getRate(
  base: Currency,
  quote: Currency,
  provider: EcbProvider = liveEcbProvider,
): Promise<RateResult> {
  if (base === quote) {
    throw new FxRateError("An FX rate must contain two different currencies.");
  }
  if (base === "EUR" && (quote === "USD" || quote === "SGD")) {
    return getEurRate(quote, provider);
  }
  if (quote === "EUR" && (base === "USD" || base === "SGD")) {
    const direct = await getEurRate(base, provider);
    if (direct.status === "UNAVAILABLE") return direct;
    const reciprocal = decimalString(
      parseDecimal("1").dividedBy(parseDecimal(direct.rate.rate)),
    );
    return Object.freeze({
      ...direct,
      rate: fxRate(base, quote, reciprocal),
    });
  }
  if (
    (base === "USD" && quote === "SGD") ||
    (base === "SGD" && quote === "USD")
  ) {
    return getCrossRate(base, quote, provider);
  }
  return unavailable(
    rateFailure("UNSUPPORTED_PAIR"),
  );
}

export { deriveEcbCrossRate, FxRateError };
