/**
 * ECB CSV parser.
 *
 * Parses the ECB SDMX `format=csvdata` response for the EXR data-flow.
 *
 * Live sample (2026-10-02):
 *   KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
 *   EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
 *   EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1225
 *
 * Financial rules applied here:
 *  - CURRENCY_DENOM must be EUR (the base in every ECB EXR series).
 *  - CURRENCY must be one of the expected quote currencies (USD | SGD).
 *  - TIME_PERIOD must be a valid YYYY-MM-DD date.
 *  - OBS_VALUE must be a positive finite plain decimal.
 *  - Zero or negative rates are rejected.
 *  - Exponent notation is rejected (uses parseDecimal from the domain layer).
 *  - Missing expected currencies are surfaced as explicit errors.
 *
 * This module is pure TypeScript with no network, database, or auth dependency.
 */

import { parseDecimal, decimalString, DecimalInputError } from "@/lib/forecast/decimal";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** One validated ECB rate row. */
export type ParsedEcbRate = Readonly<{
  /** ISO 4217 base currency — always 'EUR' for ECB EXR series. */
  baseCurrency: string;
  /** ISO 4217 quote currency — 'USD' or 'SGD'. */
  quoteCurrency: string;
  /**
   * Rate as a normalised decimal string: units of quoteCurrency per 1 EUR.
   * Always positive and finite; stored at full parsing precision.
   */
  rate: string;
  /**
   * ECB effective date (TIME_PERIOD).  May be a preceding working day on
   * weekends and public holidays — preserved exactly as received.
   */
  effectiveDate: string;
}>;

export type EcbParseResult =
  | { ok: true; rates: readonly ParsedEcbRate[]; effectiveDate: string }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const EXPECTED_QUOTES = new Set(["USD", "SGD"]);
const EXPECTED_BASE = "EUR";

/** Columns we care about, by name. */
const REQUIRED_COLUMNS = [
  "CURRENCY",
  "CURRENCY_DENOM",
  "TIME_PERIOD",
  "OBS_VALUE",
] as const;

export class EcbParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcbParseError";
  }
}

function parsePositiveRate(raw: string, context: string): string {
  const trimmed = raw.trim();
  try {
    const d = parseDecimal(trimmed);
    if (!d.greaterThan(0)) {
      throw new EcbParseError(`${context}: rate must be greater than zero, got ${JSON.stringify(trimmed)}`);
    }
    return decimalString(d);
  } catch (err) {
    if (err instanceof EcbParseError) throw err;
    if (err instanceof DecimalInputError) {
      throw new EcbParseError(`${context}: invalid rate value ${JSON.stringify(trimmed)}`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate raw ECB CSV text.
 *
 * Returns an EcbParseResult:
 *  - ok:true  — all expected quote currencies found and valid
 *  - ok:false — structural or data error with a human-readable reason
 *
 * Does NOT throw; callers check the discriminant.
 */
export function parseEcbCsv(csv: string): EcbParseResult {
  try {
    return _parseEcbCsv(csv);
  } catch (err) {
    const reason = err instanceof EcbParseError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Unknown parse error";
    return { ok: false, reason };
  }
}

function _parseEcbCsv(csv: string): EcbParseResult {
  if (!csv || !csv.trim()) {
    throw new EcbParseError("ECB response is empty");
  }

  // Split into non-empty lines (CRLF or LF)
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new EcbParseError(
      `ECB response has too few lines: expected header + data, got ${lines.length}`,
    );
  }

  // --- Parse header ---
  const headers = lines[0].split(",").map((h) => h.replace(/^["']|["']$/g, "").trim());
  const idx: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) {
    const i = headers.indexOf(col);
    if (i === -1) {
      throw new EcbParseError(`ECB CSV is missing required column "${col}"`);
    }
    idx[col] = i;
  }

  // --- Parse data rows ---
  const rates: ParsedEcbRate[] = [];
  const seenEffectiveDates = new Set<string>();

  for (let lineNum = 1; lineNum < lines.length; lineNum++) {
    const cols = lines[lineNum].split(",").map((c) => c.replace(/^["']|["']$/g, "").trim());

    const quoteCurrency = cols[idx["CURRENCY"]] ?? "";
    const baseCurrency = cols[idx["CURRENCY_DENOM"]] ?? "";
    const timePeriod = cols[idx["TIME_PERIOD"]] ?? "";
    const obsValue = cols[idx["OBS_VALUE"]] ?? "";

    const ctx = `row ${lineNum + 1}`;

    // Currency code format
    if (!CURRENCY_RE.test(quoteCurrency)) {
      throw new EcbParseError(`${ctx}: malformed CURRENCY "${quoteCurrency}"`);
    }
    if (!CURRENCY_RE.test(baseCurrency)) {
      throw new EcbParseError(`${ctx}: malformed CURRENCY_DENOM "${baseCurrency}"`);
    }

    // Base must be EUR
    if (baseCurrency !== EXPECTED_BASE) {
      throw new EcbParseError(
        `${ctx}: expected CURRENCY_DENOM=EUR, got "${baseCurrency}"`,
      );
    }

    // We only accept the expected quote currencies
    if (!EXPECTED_QUOTES.has(quoteCurrency)) {
      throw new EcbParseError(
        `${ctx}: unexpected CURRENCY "${quoteCurrency}"; expected one of ${[...EXPECTED_QUOTES].join(", ")}`,
      );
    }

    // Check for duplicate currency rows
    if (rates.some((r) => r.quoteCurrency === quoteCurrency)) {
      throw new EcbParseError(`${ctx}: duplicate rate for CURRENCY "${quoteCurrency}"`);
    }

    // Date format
    if (!DATE_RE.test(timePeriod)) {
      throw new EcbParseError(`${ctx}: invalid TIME_PERIOD "${timePeriod}"`);
    }

    seenEffectiveDates.add(timePeriod);

    const rate = parsePositiveRate(obsValue, ctx);

    rates.push(
      Object.freeze({
        baseCurrency: EXPECTED_BASE,
        quoteCurrency,
        rate,
        effectiveDate: timePeriod,
      }),
    );
  }

  // --- Completeness check ---
  for (const expected of EXPECTED_QUOTES) {
    if (!rates.some((r) => r.quoteCurrency === expected)) {
      throw new EcbParseError(
        `ECB response is missing required currency "${expected}"`,
      );
    }
  }

  // All rows should share the same effective date (one observation per series)
  if (seenEffectiveDates.size > 1) {
    throw new EcbParseError(
      `ECB response contains inconsistent effective dates: ${[...seenEffectiveDates].join(", ")}`,
    );
  }

  const effectiveDate = [...seenEffectiveDates][0];
  return { ok: true, rates, effectiveDate };
}

// ---------------------------------------------------------------------------
// Cross-rate helper
// ---------------------------------------------------------------------------

/**
 * Derive a cross-rate between two currencies from parsed ECB rows.
 *
 * ECB rates represent currency units per EUR (EUR/USD, EUR/SGD).
 * Rule: X -> Y cross rate = ECB_Y / ECB_X (where ECB_EUR = 1).
 *
 * cross(USD, SGD) = ECB_SGD / ECB_USD  (SGD per 1 USD)
 * cross(SGD, USD) = ECB_USD / ECB_SGD  (USD per 1 SGD)
 * cross(EUR, USD) = ECB_USD / 1        (USD per 1 EUR)
 * cross(USD, EUR) = 1 / ECB_USD        (EUR per 1 USD)
 * cross(X, X)     = 1
 *
 * Returns null if either leg is missing.
 */
export function deriveEcbCrossRate(
  from: string,
  to: string,
  rates: readonly ParsedEcbRate[],
): string | null {
  if (from === to) return "1";

  const getRate = (curr: string): string | null => {
    if (curr === "EUR") return "1";
    return rates.find((r) => r.quoteCurrency === curr)?.rate ?? null;
  };

  const fromRate = getRate(from);
  const toRate = getRate(to);
  if (!fromRate || !toRate) return null;

  // cross = toRate / fromRate (units of `to` per 1 `from`)
  const cross = parseDecimal(toRate).dividedBy(parseDecimal(fromRate));
  return decimalString(cross);
}
