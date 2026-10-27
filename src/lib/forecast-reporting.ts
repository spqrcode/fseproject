import "server-only";
import { getForecastInput, type ForecastInput as StoredForecastInput } from "@/lib/forecast-input-store";
import {
  appliedFactor,
  convertForecastInput,
  runForecast,
  toForecastInput,
  type Currency,
  type ForecastInput,
  type ForecastResult,
} from "@/lib/forecast";
import { getRate, type RateFailure } from "@/lib/fx/rate-service";
import { liveEcbProvider, type EcbProvider } from "@/lib/fx/ecb-provider";
import type { ReportingCurrency } from "@/lib/currency";

// How the figures relate to the reporting currency, so a page can say it instead of guessing.
export type Conversion =
  | { status: "NONE"; from: Currency; to: Currency }                       // same currency, nothing to convert
  | {
      status: "CURRENT" | "STALE";
      from: Currency; to: Currency;
      factor: string;                                                      // 1 unit of `from` in `to`
      effectiveDate: string; provider: string; fetchedAt: Date;
      refreshFailure: RateFailure | null;
    };

export type ReportingForecast =
  | {
      available: true;
      account: { id: string; name: string; currency: ReportingCurrency };
      conversion: Conversion;
      input: ForecastInput;                                                // the engine input, converted
      result: ForecastResult;                                              // in the reporting currency
    }
  | {
      available: false;                                                    // no usable rate: no number is shown
      account: { id: string; name: string; currency: ReportingCurrency };
      conversion: { status: "UNAVAILABLE"; from: Currency; to: Currency; failure: RateFailure };
    };

// One account's forecast expressed in the reporting currency. Ownership comes from getForecastInput (session token),
// so another user's account gives null. Rates come from persisted ECB snapshots through the rate service (a snapshot
// younger than one hour is used without a network call, otherwise a refresh is attempted); STALE is labelled, and without any usable rate the forecast is unavailable
// instead of being shown in the wrong currency or with an invented rate.
export async function getForecastInReportingCurrency(
  token: string | undefined,
  input: { accountId: unknown; startDate: string; endDate: string },
  reporting: Currency,
  provider: EcbProvider = liveEcbProvider,
): Promise<ReportingForecast | null> {
  const stored = await getForecastInput(token, input);
  return stored ? forecastStoredInReportingCurrency(stored, reporting, provider) : null;
}

// The same, for a caller that has already read the stored input (and its presentation metadata) itself.
export async function forecastStoredInReportingCurrency(
  stored: StoredForecastInput,
  reporting: Currency,
  provider: EcbProvider = liveEcbProvider,
): Promise<ReportingForecast> {
  const engineInput = toForecastInput(stored);
  const account = stored.account;

  if (engineInput.currency === reporting) {
    return { available: true, account, conversion: { status: "NONE", from: reporting, to: reporting }, input: engineInput, result: runForecast(engineInput) };
  }
  const rate = await getRate(engineInput.currency, reporting, provider);
  if (rate.status === "UNAVAILABLE") {
    return { available: false, account, conversion: { status: "UNAVAILABLE", from: engineInput.currency, to: reporting, failure: rate.failure } };
  }
  const converted = convertForecastInput(engineInput, reporting, rate.rate);
  return {
    available: true,
    account,
    conversion: {
      status: rate.status,
      from: engineInput.currency, to: reporting,
      factor: appliedFactor(rate.rate, engineInput.currency),
      effectiveDate: rate.effectiveDate, provider: rate.provider, fetchedAt: rate.fetchedAt,
      refreshFailure: rate.refreshFailure,
    },
    input: converted,
    result: runForecast(converted),
  };
}
