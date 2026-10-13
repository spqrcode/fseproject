import type { Conversion, ReportingForecast } from "@/lib/forecast-reporting";
import { formatDate, formatRate } from "@/lib/format";

// Says how the figures relate to the reporting currency. Shared by the Liquidity overview and the Scenario lab
// comparison, so both pages state the rate, its source and date, and whether it is stale, in the same words.
export function ConversionNote({ conversion }: { conversion: ReportingForecast["conversion"] }) {
  if (conversion.status !== "CURRENT" && conversion.status !== "STALE") return null;
  const rate: Extract<Conversion, { factor: string }> = conversion;
  return <p className="notice" role="note">This account is in {rate.from}. Amounts are converted into {rate.to} at 1 {rate.from} = <data value={rate.factor}>{formatRate(rate.factor)}</data> {rate.to}, the {rate.provider.toUpperCase()} rate effective {formatDate(rate.effectiveDate)}.{rate.status === "STALE" && " This is the latest rate available: it could not be refreshed, so it may be out of date."}</p>;
}

// Shown instead of any figure when no usable rate exists.
export function NoRateNotice({ conversion, what }: { conversion: ReportingForecast["conversion"]; what: "forecast" | "comparison" }) {
  const failure = conversion.status === "UNAVAILABLE" ? conversion.failure.message : "";
  return <p className="notice error" role="note">No exchange rate from {conversion.from} to {conversion.to} is available. {failure} No {what} is shown in {conversion.to}, because a figure in the wrong currency or with an invented rate would be misleading. Change the reporting currency in settings to see this account in {conversion.from}.</p>;
}
