import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace-store";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { listCashAccounts, listCashEvents } from "@/lib/cash-events-store";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ForecastFigure } from "@/components/placeholder-figures";
export const metadata = { title: "Liquidity overview" };
type Module = { title: string; text: string; state: string; tone: "ready" | "pending" | "value"; href: string; action: string };
export default async function LiquidityOverview() {
  await requireUser();
  const token = await sessionToken();
  const [workspace, currency, accounts, events] = await Promise.all([
    getWorkspace(token),
    getReportingCurrency(token),
    listCashAccounts(token),
    listCashEvents(token),
  ]);
  const reporting = currency ?? DEFAULT_REPORTING_CURRENCY;
  const modules: Module[] = [
    { title: "Workspace", text: workspace ? "Your workspace is saved and only you can access it." : "Name your workspace to get started.", state: workspace ? "Ready" : "Not created", tone: workspace ? "ready" : "pending", href: "/workspace", action: "Open workspace" },
    { title: "Reporting currency", text: `Figures will be reported in ${currencyLabel(reporting)}.`, state: reporting, tone: "value", href: "/settings", action: "Change currency" },
    { title: "Cash events", text: accounts.length > 0 ? "Accounts and planned income and expenses are ready for forecasting." : "Add a cash account, then record expected income and expenses.", state: accounts.length > 0 ? `${events.length} ${events.length === 1 ? "event" : "events"}` : "Set up", tone: accounts.length > 0 ? "ready" : "pending", href: "/cash-events", action: "Open cash events" },
    { title: "Scenario lab", text: "Create delayed-invoice scenarios and preview ECB exchange-rate shocks. Cash-flow comparisons will follow the forecast-input adapter.", state: workspace ? "Preview available" : "Set up", tone: workspace ? "ready" : "pending", href: "/scenarios", action: "Open scenario lab" },
  ];
  return <>
    <PageHeading eyebrow="Liquidity" title="Liquidity overview" intro={workspace ? workspace.name : "Your financial twin starts here."}>
      {workspace && <Link className="button secondary" href="/workspace">Manage workspace</Link>}
    </PageHeading>
    {!workspace && <section className="callout" aria-labelledby="onboarding-heading">
      <div><p className="eyebrow">First step</p><h2 id="onboarding-heading">Set up your workspace.</h2><p>Give your workspace a name. Cash events and scenarios will belong to it, and only you can see it.</p></div>
      <Link className="button inverse" href="/workspace">Create your workspace</Link>
    </section>}
    <EmptyState eyebrow="Awaiting the forecast-input adapter" title="The liquidity forecast is not connected yet." figure={<ForecastFigure />}>
      <p>Once the shared adapter is connected, this page will show your projected balance over time, its lowest point and how long your cash lasts, in {currencyLabel(reporting)}. Nothing is estimated today, so no number is shown until a real projection exists.</p>
    </EmptyState>
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
    <aside className="footnote" aria-label="About this version"><p className="eyebrow">About this version</p><p>Account access, workspace settings, cash events, delayed-invoice scenarios and ECB rate previews are available. Numerical liquidity and scenario forecasts wait for the shared forecast-input adapter; no balance is fabricated in its place.</p></aside>
  </>;
}
