import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace-store";
import { listCashEvents } from "@/lib/cash-events-store";
import { getScenarios, getAdjustments } from "@/lib/scenario-store";
import { getScenarioFxShocks } from "@/lib/fx/shock-store";
import { getRate } from "@/lib/fx/rate-service";
import { buildScenarioFxResult, type ScenarioFxResult } from "@/lib/fx/fx-shock";
import { parseDecimal } from "@/lib/forecast/decimal";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, REPORTING_CURRENCIES, currencyLabel } from "@/lib/currency";
import { formatDate, formatMoney, formatRate } from "@/lib/format";
import { reportingCurrencySchema } from "@/lib/validation";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ScenarioFigure } from "@/components/placeholder-figures";
import { DelayForm, SaveShockForm, ScenarioForm } from "@/components/scenario-forms";

export const metadata = { title: "Scenario lab" };
type Params = { scenario?: string; base?: string; quote?: string; shock?: string; preview?: string; success?: string };
const successMessages: Record<string, string> = {
  "scenario-added": "Scenario created.",
  "delay-added": "Invoice delayed in this scenario. The original event is unchanged.",
  "shock-added": "FX shock saved to this scenario.",
};

export default async function ScenariosPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const token = await sessionToken();
  const params = await searchParams;
  const [workspace, reporting, scenarios, events] = await Promise.all([
    getWorkspace(token), getReportingCurrency(token), getScenarios(token), listCashEvents(token),
  ]);
  const selected = scenarios.find(item => item.id === params.scenario) ?? scenarios[0];
  const adjustmentsPromise = selected ? getAdjustments(token, selected.id) : Promise.resolve([]);
  const base = reportingCurrencySchema.safeParse(params.base).data ?? "EUR";
  const quote = reportingCurrencySchema.safeParse(params.quote).data ?? (base === "USD" ? "SGD" : "USD");
  const shock = params.shock ?? "-10";
  let preview: ScenarioFxResult | null = null;
  let previewError: string | null = null;
  if (workspace && params.preview === "1") {
    if (base === quote || shock.length > 32 || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(shock)) {
      previewError = "Choose two different currencies and a plain percentage.";
    } else {
      try {
        preview = buildScenarioFxResult(await getRate(base, quote), { baseCurrency: base, quoteCurrency: quote }, shock);
      } catch {
        previewError = "The rate preview could not be calculated. Check the percentage and try again.";
      }
    }
  }
  const [adjustments, savedShocks] = await Promise.all([
    adjustmentsPromise,
    selected ? getScenarioFxShocks(token, selected.id) : Promise.resolve([]),
  ]);
  const adjustedIds = new Set(adjustments.filter(item => item.status === "active").map(item => item.cashEventId));
  const invoices = events.filter(item => item.status === "expected" && parseDecimal(item.amount).greaterThan(0) && !adjustedIds.has(item.id));
  const eventById = new Map(events.map(item => [item.id, item]));

  return <>
    <PageHeading eyebrow="What if" title="Scenario lab" intro="Keep real cash events intact while exploring a delayed invoice or an exchange-rate shock." />
    {successMessages[params.success ?? ""] && <p role="status" className="notice success page-notice">{successMessages[params.success ?? ""]}</p>}
    {!workspace ? <EmptyState eyebrow="Workspace required" title="Create your workspace first." figure={<ScenarioFigure />}>
      <p>Scenarios belong to your private workspace. Set it up before comparing alternatives.</p>
      <p className="empty-action"><Link className="button" href="/workspace">Create workspace</Link></p>
    </EmptyState> : <div className="scenario-layout">
      <aside className="scenario-sidebar">
        <section className="cash-panel" aria-labelledby="scenario-list-heading">
          <p className="eyebrow">Your alternatives</p><h2 id="scenario-list-heading">Scenarios</h2>
          {scenarios.length === 0 ? <p className="muted">No scenarios yet. Name one to start a separate what-if view.</p> : <ul className="scenario-list">
            {scenarios.map(item => <li key={item.id}><Link aria-current={selected?.id === item.id ? "page" : undefined} href={`/scenarios?scenario=${item.id}`}>{item.name}</Link></li>)}
          </ul>}
          <ScenarioForm />
        </section>
        <p className="scenario-note">Scenario adjustments are hypothetical. They never edit the original cash event or ECB snapshot.</p>
      </aside>
      <div className="scenario-main">
        {selected ? <section className="scenario-section" aria-labelledby="delay-heading">
          <p className="eyebrow">Selected scenario</p><h2 id="delay-heading">{selected.name}</h2>
          <p className="muted">Original and delayed dates are shown side by side. The real cash event keeps its date.</p>
          {adjustments.length > 0 && <table className="data-table scenario-comparison">
            <caption className="visually-hidden">Invoice delay comparison</caption>
            <thead><tr><th scope="col">Invoice</th><th scope="col">Base date</th><th scope="col">Scenario date</th></tr></thead>
            <tbody>
              {adjustments.map(item => {
                const event = eventById.get(item.cashEventId);
                return <tr key={item.id}>
                  <th scope="row">{event ? `${event.description} · ${formatMoney(event.amount, event.currency)}` : "Original event unavailable"}</th>
                  <td>{event ? formatDate(event.expectedDate) : "Unavailable"}</td>
                  <td>{item.status === "active" ? formatDate(item.dateOverride)
                    : item.status === "not_applicable" ? "No longer applies: the invoice was settled, cancelled or changed"
                    : "Invalid adjustment"}</td>
                </tr>;
              })}
            </tbody>
          </table>}
          {invoices.length > 0 ? <DelayForm scenarioId={selected.id} invoices={invoices} /> : <p className="muted">Add an expected positive cash event in <Link href="/cash-events">Cash events</Link> to try an invoice delay.</p>}
        </section> : <EmptyState eyebrow="No scenario selected" title="Start with a named scenario." figure={<ScenarioFigure />}>
          <p>Once you create one, you can delay an invoice without changing the real event.</p>
        </EmptyState>}
        <section className="scenario-section" aria-labelledby="fx-heading">
          <p className="eyebrow">ECB exchange rates</p><h2 id="fx-heading">Percentage FX shock</h2>
          <p className="muted">Previewing retrieves the latest available ECB snapshot; it does not change it.</p>
          <form method="get" action="/scenarios" className="scenario-preview-form">
            {selected && <input type="hidden" name="scenario" value={selected.id} />}
            <input type="hidden" name="preview" value="1" />
            <div className="field"><label htmlFor="fx-base">Base currency</label><select id="fx-base" name="base" defaultValue={base}>{REPORTING_CURRENCIES.map(item => <option value={item} key={item}>{item}</option>)}</select></div>
            <div className="field"><label htmlFor="fx-quote">Quote currency</label><select id="fx-quote" name="quote" defaultValue={quote}>{REPORTING_CURRENCIES.map(item => <option value={item} key={item}>{item}</option>)}</select></div>
            <div className="field"><label htmlFor="fx-shock">Shock (%)</label><input id="fx-shock" name="shock" inputMode="decimal" required maxLength={32} defaultValue={shock} aria-describedby="fx-shock-hint" /><small id="fx-shock-hint">-10 means minus 10%, not a ratio of -0.1. Must be greater than -100%.</small></div>
            <button className="button" type="submit">Preview shock</button>
          </form>
          {previewError && <p role="alert" className="notice error">{previewError}</p>}
          {preview && (preview.freshness === "UNAVAILABLE" ? <div role="status" className="scenario-rate-state"><p className="state state-pending">Rate unavailable</p><p>{preview.failure.message}</p><p>No adjusted rate is shown or invented.</p></div> : <div className="scenario-rate-state" role="status">
            <p className={`state ${preview.freshness === "CURRENT" ? "state-ready" : "state-pending"}`}>{preview.freshness === "CURRENT" ? "Current" : "Stale"} · {preview.provider.toUpperCase()} · {formatDate(preview.effectiveDate)}</p>
            <div className="scenario-rate-grid"><div><small>ECB source rate</small><data value={preview.sourceRate}>1 {preview.baseCurrency} = {formatRate(preview.sourceRate)} {preview.quoteCurrency}</data></div><div><small>Hypothetical · {preview.shockPercent}%</small><data value={preview.adjustedRate}>1 {preview.baseCurrency} = {formatRate(preview.adjustedRate)} {preview.quoteCurrency}</data></div></div>
            {preview.freshness === "STALE" && <p className="muted">Last available observation. {preview.refreshFailure?.message}</p>}
            {selected && base === "EUR" && (quote === "USD" || quote === "SGD") && preview.sourceSnapshotIds.length === 1 && <SaveShockForm scenarioId={selected.id} snapshotId={preview.sourceSnapshotIds[0]} shockPercent={preview.shockPercent} />}
            {selected && base !== "EUR" && <p className="muted">Cross and reciprocal rates can be previewed; saving supports direct ECB EUR pairs only.</p>}
          </div>)}
          {selected && savedShocks.length > 0 && <div className="scenario-saved" aria-label="Saved FX shocks"><h3>Saved in {selected.name}</h3><ul>{savedShocks.map(item => <li key={item.id}>{item.snapshot
              ? <>{item.shockPercent}% on {item.snapshot.baseCurrency}/{item.snapshot.quoteCurrency} · {item.snapshot.provider.toUpperCase()} {formatDate(item.snapshot.effectiveDate)} · <data value={item.snapshot.rate}>{formatRate(item.snapshot.rate)}</data></>
              : <>{item.shockPercent}% shock · rate snapshot not available</>}
            {item.newerSnapshotAvailable && <> · <span className="state state-pending">Newer ECB rate available; this saved shock still uses its original snapshot.</span></>}
            {item.status === "invalid" && <> · <span className="state state-pending">Invalid</span></>}</li>)}</ul></div>}
        </section>
      </div>
    </div>}
    <aside className="footnote" aria-label="About scenario results"><p className="eyebrow">About results</p><p>Rates are decimal strings from ECB snapshots. Stale or unavailable data is labelled. This page shows rates and dates; it does not compute a cash-flow forecast, so no balance is estimated here. Reporting currency: {currencyLabel(reporting ?? DEFAULT_REPORTING_CURRENCY)}.</p></aside>
  </>;
}
