import type { ScenarioComparison, SkippedAdjustment } from "@/lib/forecast";
import { formatDate, formatMoney } from "@/lib/format";

type Described = { id: string; description: string; originalDate: string; overrideDate: string };

const SKIPPED_TEXT: Record<SkippedAdjustment["reason"], string> = {
  invalid: "marked invalid",
  not_applicable: "no longer applies: the invoice was received, paid or cancelled, or was edited so the delay no longer makes sense",
  not_in_forecast: "belongs to another account, so it is not part of this account's forecast",
};

function runwayText(days: number | null, horizon: number) {
  if (days === null) return `Not reached in ${horizon} days`;
  return days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"}`;
}

// The base forecast and the scenario forecast side by side, and the difference split into one effect per delayed
// invoice that adds up to it. Everything shown is computed by the engine; the page only formats. Amounts are in the
// account's own currency, because conversion into the reporting currency is not connected yet.
export function ScenarioComparisonPanel({ comparison, currency, horizon, described }: {
  comparison: ScenarioComparison; currency: string; horizon: number; described: Described[];
}) {
  const { base, scenario } = comparison;
  const money = (value: string, signed = false) => formatMoney(value, currency, { signed });
  const last = base.timeline[base.timeline.length - 1].date;
  const byAdjustment = new Map(described.map(item => [item.id, item]));
  const rows: { label: string; base: string; scenario: string; difference?: string }[] = [
    { label: `Balance on ${formatDate(last)}`, base: money(base.closingBalance), scenario: money(scenario.closingBalance), difference: money(comparison.closingDelta, true) },
    { label: "Lowest balance", base: money(base.minimumBalance), scenario: money(scenario.minimumBalance), difference: money(comparison.minimumDelta, true) },
    { label: "Date of the lowest balance", base: formatDate(base.minimumDate), scenario: formatDate(scenario.minimumDate) },
    { label: `First day below ${money(base.dangerThresholdAmount)}`, base: base.firstDangerDate ? formatDate(base.firstDangerDate) : "Not reached", scenario: scenario.firstDangerDate ? formatDate(scenario.firstDangerDate) : "Not reached" },
    { label: "Runway", base: runwayText(base.runwayDays, horizon), scenario: runwayText(scenario.runwayDays, horizon) },
  ];
  return <div className="comparison">
    <table className="data-table comparison-table">
      <caption className="visually-hidden">Base forecast and scenario forecast side by side</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">Base</th><th scope="col">Scenario</th><th scope="col">Difference</th></tr></thead>
      <tbody>
        {rows.map(row => <tr key={row.label}>
          <th scope="row">{row.label}</th>
          <td className="amount">{row.base}</td>
          <td className="amount">{row.scenario}</td>
          <td className="amount">{row.difference ?? "–"}</td>
        </tr>)}
      </tbody>
    </table>

    <div className="comparison-effects">
      <h3>What causes the difference</h3>
      {comparison.contributions.length === 0
        ? <p className="muted">No adjustment applies to this account&apos;s forecast, so the scenario equals the base.</p>
        : <>
          <ul>
            {comparison.contributions.map(item => {
              const info = byAdjustment.get(item.adjustmentId);
              const zero = parseFloat(item.closingDelta) === 0;
              return <li key={item.adjustmentId}>
                <span>{info ? `${info.description}: ${formatDate(info.originalDate)} → ${formatDate(info.overrideDate)}` : "Delayed invoice"}</span>
                <span className="amount">{money(item.closingDelta, true)}</span>
                {zero && <small className="muted">Still arrives inside the forecast range, so only the balance in between changes.</small>}
              </li>;
            })}
          </ul>
          <p className="comparison-total">Difference in closing balance <span className="amount">{money(comparison.closingDelta, true)}</span> = sum of the effects above <span className="amount">{money(comparison.contributionsTotal, true)}</span>.</p>
        </>}
    </div>

    {comparison.skipped.length > 0 && <div className="comparison-skipped">
      <h3>Not applied to this forecast</h3>
      <ul>
        {comparison.skipped.map(item => <li key={item.adjustmentId}>{SKIPPED_TEXT[item.reason]}</li>)}
      </ul>
    </div>}
  </div>;
}
