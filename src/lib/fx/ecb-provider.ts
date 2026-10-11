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

import "server-only";

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
const MAX_RESPONSE_BYTES = 64 * 1024;
const PROVIDER_UNAVAILABLE_REASON = "ECB exchange rates are temporarily unavailable.";

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`ECB response exceeded ${MAX_RESPONSE_BYTES} bytes.`);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error(`ECB response exceeded ${MAX_RESPONSE_BYTES} bytes.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`ECB response exceeded ${MAX_RESPONSE_BYTES} bytes.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Live ECB provider.  Must only be used in server-side code.
 * Import it only inside `server-only` guarded modules.
 */
export const liveEcbProvider: EcbProvider = {
  async fetchRates(): Promise<EcbFetchResult> {
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
        console.error("ECB request returned a non-success status.", {
          status: response.status,
          statusText: response.statusText,
        });
        return {
          ok: false,
          reason: PROVIDER_UNAVAILABLE_REASON,
          fetchedAt: new Date(),
        };
      }
      const csv = await readLimitedText(response);
      // Freshness begins when the complete response has been received, not
      // when the request started.
      return { ok: true, csv, fetchedAt: new Date() };
    } catch (error: unknown) {
      console.error("ECB request failed.", error);
      return {
        ok: false,
        reason: PROVIDER_UNAVAILABLE_REASON,
        fetchedAt: new Date(),
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
