/**
 * ECB exchange-rate provider adapter.
 *
 * The adapter interface is the only surface tests need to replace.
 * The real implementation calls the ECB SDMX REST API over HTTPS;
 * it is never called directly from browser code.
 *
 * ECB endpoint:
 *   https://data-api.ecb.europa.eu/service/data/EXR/D.USD+SGD.EUR.SP00.A
 *       ?lastNObservations=1&detail=dataonly&format=csvdata
 *
 * Interpretation:
 *   Series: EXR (exchange rates)
 *   Frequency: D (daily)
 *   CURRENCY: USD or SGD  ← this is the QUOTE when read as units-per-EUR
 *   CURRENCY_DENOM: EUR   ← BASE
 *   TIME_PERIOD: YYYY-MM-DD effective date (may be last working day)
 *   OBS_VALUE: rate (units of CURRENCY per 1 EUR)
 */

/** Raw response from the network layer; not yet parsed or validated. */
export type EcbFetchResult =
  | { ok: true; csv: string; fetchedAt: Date }
  | { ok: false; reason: string; fetchedAt: Date };

/** Pluggable provider so tests can inject deterministic fixtures. */
export interface EcbProvider {
  fetchRates(): Promise<EcbFetchResult>;
}

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------

const ECB_URL =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+SGD.EUR.SP00.A" +
  "?lastNObservations=1&detail=dataonly&format=csvdata";

/** Milliseconds before the HTTP fetch is aborted. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Live ECB provider.  Must only be used in server-side code.
 * Import it only inside `server-only` guarded modules.
 */
export const liveEcbProvider: EcbProvider = {
  async fetchRates(): Promise<EcbFetchResult> {
    const fetchedAt = new Date();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(ECB_URL, {
        signal: controller.signal,
        headers: { Accept: "text/csv" },
        // Disable Next.js data cache so every server-side call hits the
        // network (the DB snapshot cache is our durable store instead).
        cache: "no-store",
      });
      if (!response.ok) {
        return {
          ok: false,
          reason: `ECB returned HTTP ${response.status} ${response.statusText}`,
          fetchedAt,
        };
      }
      const csv = await response.text();
      return { ok: true, csv, fetchedAt };
    } catch (error: unknown) {
      const reason =
        error instanceof Error
          ? error.name === "AbortError"
            ? `ECB request timed out after ${FETCH_TIMEOUT_MS}ms`
            : error.message
          : "Unknown network error";
      return { ok: false, reason, fetchedAt };
    } finally {
      clearTimeout(timer);
    }
  },
};
