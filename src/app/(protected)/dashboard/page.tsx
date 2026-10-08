import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace-store";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ForecastFigure } from "@/components/placeholder-figures";
export const metadata = { title: "Liquidity overview" };
type Module = { title: string; text: string; state: string; tone: "ready" | "pending" | "value"; href: string; action: string };
export default async function LiquidityOverview() {
  await requireUser();
  const token = await sessionToken();
  const [workspace, currency] = await Promise.all([getWorkspace(token), getReportingCurrency(token)]);
  const reporting = currency ?? DEFAULT_REPORTING_CURRENCY;
  const modules: Module[] = [
    { title: "Workspace", text: workspace ? "Your workspace is saved and only you can access it." : "Name your workspace to get started.", state: workspace ? "Ready" : "Not created", tone: workspace ? "ready" : "pending", href: "/workspace", action: "Open workspace" },
    { title: "Reporting currency", text: `Figures will be reported in ${currencyLabel(reporting)}.`, state: reporting, tone: "value", href: "/settings", action: "Change currency" },
    { title: "Cash events", text: "Planned income and expenses will be listed once cash events are stored.", state: "Not connected yet", tone: "pending", href: "/cash-events", action: "Open cash events" },
    { title: "Scenario lab", text: "What-if scenarios, including exchange-rate shocks, will appear once scenario analysis is delivered.", state: "Not connected yet", tone: "pending", href: "/scenarios", action: "Open scenario lab" },
  ];
  return <>
    <PageHeading eyebrow="Liquidity" title="Liquidity overview" intro={workspace ? workspace.name : "Your financial twin starts here."}>
      {workspace && <Link className="button secondary" href="/workspace">Manage workspace</Link>}
    </PageHeading>
    {!workspace && <section className="callout" aria-labelledby="onboarding-heading">
      <div><p className="eyebrow">First step</p><h2 id="onboarding-heading">Set up your workspace.</h2><p>Give your workspace a name. Cash events and scenarios will belong to it, and only you can see it.</p></div>
      <Link className="button inverse" href="/workspace">Create your workspace</Link>
    </section>}
    <EmptyState eyebrow="Awaiting the forecast engine" title="The liquidity forecast is not connected yet." figure={<ForecastFigure />}>
      <p>Once it is delivered, this page will show your projected balance over time, its lowest point and how long your cash lasts, in {currencyLabel(reporting)}. Nothing is estimated today, so no number is shown until a real projection exists.</p>
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
    <aside className="footnote" aria-label="About this version"><p className="eyebrow">About this version</p><p>Account access, your workspace and the reporting currency are available. The liquidity forecast, cash events and the scenario lab are being built by other members of the team; until they are connected, no figures are estimated or simulated on these pages.</p></aside>
  </>;
}
