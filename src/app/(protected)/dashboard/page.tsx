import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace-store";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { listCashAccounts, type CashAccount } from "@/lib/cash-events-store";
import { getLiquidityForecast, type LiquidityForecast } from "@/lib/liquidity-forecast";
import { HORIZONS, firstParam, forecastWindow, parseHorizon, type Horizon } from "@/lib/liquidity-overview";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ForecastFigure } from "@/components/placeholder-figures";
import { LiquidityChart } from "@/components/liquidity-chart";
export const metadata = { title: "Liquidity overview" };
type Module = { title: string; text: string; state: string; tone: "ready" | "pending" | "value"; href: string; action: string };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LiquidityOverview({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const token = await sessionToken();
  const params = await searchParams;
  const [workspace, currency, accounts] = await Promise.all([getWorkspace(token), getReportingCurrency(token), listCashAccounts(token)]);
  const reporting = currency ?? DEFAULT_REPORTING_CURRENCY;
  const horizon = parseHorizon(params.days);
  // Only the caller's own accounts can be chosen; an unknown id in the URL falls back to the first one.
  const requested = firstParam(params.account);
  const account = accounts.find(item => item.id === requested) ?? accounts[0];
  const window = forecastWindow(new Date(), horizon);
  const forecast = account ? await getLiquidityForecast(token, { accountId: account.id, ...window }) : null;

  const modules: Module[] = [
    { title: "Workspace", text: workspace ? "Your workspace is saved and only you can access it." : "Name your workspace to get started.", state: workspace ? "Ready" : "Not created", tone: workspace ? "ready" : "pending", href: "/workspace", action: "Open workspace" },
    { title: "Reporting currency", text: `Figures will be reported in ${currencyLabel(reporting)}. Until exchange-rate conversion is connected, each forecast is shown in its account's currency.`, state: reporting, tone: "value", href: "/settings", action: "Change currency" },
    { title: "Cash events", text: accounts.length > 0 ? "Accounts and planned income and expenses feed the forecast above." : "Add a cash account, then record expected income and expenses.", state: accounts.length > 0 ? `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}` : "Set up", tone: accounts.length > 0 ? "ready" : "pending", href: "/cash-events", action: "Open cash events" },
    { title: "Scenario lab", text: "What-if scenarios, including delayed invoices and exchange-rate shocks.", state: workspace ? "Preview" : "Set up", tone: workspace ? "ready" : "pending", href: "/scenarios", action: "Open scenario lab" },
  ];
  return <>
    <PageHeading eyebrow="Liquidity" title="Liquidity overview" intro={workspace ? workspace.name : "Your financial twin starts here."}>
      {workspace && <Link className="button secondary" href="/workspace">Manage workspace</Link>}
    </PageHeading>
    {!workspace && <section className="callout" aria-labelledby="onboarding-heading">
      <div><p className="eyebrow">First step</p><h2 id="onboarding-heading">Set up your workspace.</h2><p>Give your workspace a name. Cash events and scenarios will belong to it, and only you can see it.</p></div>
      <Link className="button inverse" href="/workspace">Create your workspace</Link>
    </section>}
    {account && forecast
      ? <Forecast accounts={accounts} account={account} horizon={horizon} forecast={forecast} reporting={reporting} />
      : <EmptyState eyebrow="No cash account yet" title="Add a cash account to see your forecast." figure={<ForecastFigure />}>
          <p>The forecast starts from an account&apos;s balance today and adds the income and expenses you expect. Nothing is estimated before that, so no number is shown until a real account exists.</p>
          <p><Link className="button secondary" href="/cash-events">Add a cash account</Link></p>
        </EmptyState>}
    <section className="modules" aria-labelledby="modules-heading">
      <div className="index-head"><h2 id="modules-heading">Modules</h2><p className="eyebrow">{modules.length} modules</p></div>
      <ol className="index-list">
        {modules.map((module, index) => <li key={module.title} className="index-row">
          <span className="index-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div className="index-body"><h3>{module.title}</h3><p>{module.text}</p></div>
          <p className={`state state-${module.tone}`}>{module.state}</p>
          <Link className="index-link" href={module.href}>{module.action}<span aria-hidden="true">→</span></Link>
        </li>)}
      </ol>
    </section>
    <aside className="footnote" aria-label="About this version"><p className="eyebrow">About this version</p><p>The forecast is deterministic: it adds the expected events of one account to its balance today, day by day, with no estimates or random paths. Each account is shown in its own currency; conversion into the reporting currency with ECB rates is the next step and is not applied yet.</p></aside>
  </>;
}

function Forecast({ accounts, account, horizon, forecast, reporting }: {
  accounts: CashAccount[]; account: CashAccount; horizon: Horizon; forecast: LiquidityForecast; reporting: string;
}) {
  const { result } = forecast;
  const money = (value: string) => formatMoney(value, result.currency);
  const last = result.timeline[result.timeline.length - 1].date;
  return <section className="forecast" aria-labelledby="forecast-heading">
    <div className="forecast-head">
      <div>
        <p className="eyebrow">{account.name} · {result.currency}</p>
        <h2 id="forecast-heading">Next {horizon} days</h2>
        <p className="muted">{formatDate(result.timeline[0].date)} to {formatDate(last)}, end-of-day balances in {result.currency}.</p>
      </div>
      <form className="forecast-controls" method="get" action="/dashboard">
        <div className="field">
          <label htmlFor="forecast-account">Account</label>
          <select id="forecast-account" name="account" defaultValue={account.id}>
            {accounts.map(item => <option key={item.id} value={item.id}>{item.name} ({item.currency})</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="forecast-days">Horizon</label>
          <select id="forecast-days" name="days" defaultValue={String(horizon)}>
            {HORIZONS.map(days => <option key={days} value={days}>{days} days</option>)}
          </select>
        </div>
        <button className="button secondary" type="submit">Show forecast</button>
      </form>
    </div>

    {result.firstDangerDate
      ? <p className="notice error" role="note">Cash falls below the danger threshold of {money(result.dangerThresholdAmount)} on {formatDate(result.firstDangerDate)}, {runway(result.runwayDays)}.</p>
      : <p className="notice success" role="note">Cash stays at or above the danger threshold of {money(result.dangerThresholdAmount)} for the next {horizon} days.</p>}
    {result.currency !== reporting && <p className="notice" role="note">This account is in {result.currency}. Your reporting currency is {reporting}; amounts are not converted yet, so they are shown in {result.currency}.{result.dangerThresholdPercent === null && ` Your workspace danger threshold is also applied as ${result.currency}, not converted from ${reporting}.`}</p>}

    <dl className="metrics">
      <div><dt>Balance today</dt><dd className="amount">{money(result.openingBalance)}</dd><dd>Settled money up to today, before today&apos;s expected events</dd></div>
      <div><dt>Lowest balance</dt><dd className="amount">{money(result.minimumBalance)}</dd><dd>{formatDate(result.minimumDate)}</dd></div>
      <div><dt>Balance on {formatDate(last)}</dt><dd className="amount">{money(result.closingBalance)}</dd><dd>{forecast.eventCount} expected {forecast.eventCount === 1 ? "event" : "events"}</dd></div>
      <div><dt>Runway</dt><dd className="amount">{result.runwayDays === null ? `${horizon}+ days` : `${result.runwayDays} ${result.runwayDays === 1 ? "day" : "days"}`}</dd><dd>{result.dangerThresholdPercent ? `Threshold: ${result.dangerThresholdPercent}% of today's balance (default)` : "Threshold set for your workspace"}</dd></div>
    </dl>

    <LiquidityChart result={result} />

    {forecast.overdue.length > 0 && <div className="overdue">
      <h3>Overdue, counted today</h3>
      <p className="muted">These expected events are past their date and not yet marked received or paid. The forecast assumes they settle today.</p>
      <ul>
        {forecast.overdue.map(event => <li key={event.id}><span>{event.description}</span> <span className="muted">was due {formatDate(event.originalDate)}</span> <span className="amount">{formatMoney(event.amount, result.currency, { signed: true })}</span></li>)}
      </ul>
    </div>}

    <details className="daily">
      <summary>Daily balances ({result.timeline.length} days)</summary>
      <table className="data-table">
        <caption className="visually-hidden">Projected end-of-day balance for {account.name}</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Balance</th></tr></thead>
        <tbody>
          {result.timeline.map(point => <tr key={point.date}>
            <td>{formatDate(point.date)}</td><td className="amount">{money(point.balance)}</td>
          </tr>)}
        </tbody>
      </table>
    </details>
  </section>;
}

function runway(days: number | null) {
  if (days === null) return "";
  if (days === 0) return "today";
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}
