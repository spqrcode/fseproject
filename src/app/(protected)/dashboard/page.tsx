import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { getPortfolio } from "@/lib/portfolio-store";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { PageHeading } from "@/components/page-heading";
export const metadata = { title: "Overview" };
type Module = { title: string; text: string; state: string; tone: "ready" | "pending" | "value"; href: string; action: string };
export default async function Dashboard() {
  await requireUser();
  const token = await sessionToken();
  const [portfolio, currency] = await Promise.all([getPortfolio(token), getReportingCurrency(token)]);
  const reporting = currency ?? DEFAULT_REPORTING_CURRENCY;
  const modules: Module[] = [
    { title: "Portfolio", text: portfolio ? "Your portfolio is saved and only you can access it." : "Name your portfolio to get started.", state: portfolio ? "Ready" : "Not created", tone: portfolio ? "ready" : "pending", href: "/portfolio", action: "Open portfolio" },
    { title: "Reporting currency", text: `Figures will be reported in ${currencyLabel(reporting)}.`, state: reporting, tone: "value", href: "/settings", action: "Change currency" },
    { title: "Forecast", text: "Projections of your financial position will appear once the forecast engine is delivered.", state: "Not connected yet", tone: "pending", href: "/forecast", action: "Open forecast" },
    { title: "Scenarios", text: "What-if scenarios, including exchange-rate changes, will appear once scenario analysis is delivered.", state: "Not connected yet", tone: "pending", href: "/scenarios", action: "Open scenarios" },
  ];
  return <>
    <PageHeading eyebrow="Workspace" title="Overview" intro={portfolio ? portfolio.name : "Your financial twin starts here."}>
      {portfolio && <Link className="button secondary" href="/portfolio">Manage portfolio</Link>}
    </PageHeading>
    {!portfolio && <section className="callout" aria-labelledby="onboarding-heading">
      <div><p className="eyebrow">First step</p><h2 id="onboarding-heading">Make room for your investments.</h2><p>Create a portfolio to give your investments a home. You can change its name at any time.</p></div>
      <Link className="button inverse" href="/portfolio">Create your portfolio</Link>
    </section>}
    <section aria-labelledby="workspace-heading">
      <div className="index-head"><h2 id="workspace-heading">Your workspace</h2><p className="eyebrow">{modules.length} modules</p></div>
      <ol className="index-list">
        {modules.map((module, index) => <li key={module.title} className="index-row">
          <span className="index-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div className="index-body"><h3>{module.title}</h3><p>{module.text}</p></div>
          <p className={`state state-${module.tone}`}>{module.state}</p>
          <Link className="index-link" href={module.href}>{module.action}<span aria-hidden="true">→</span></Link>
        </li>)}
      </ol>
    </section>
    <aside className="footnote" aria-label="About this version"><p className="eyebrow">About this version</p><p>Account access, portfolio setup and the reporting currency are available. Forecasts and scenarios are being built by other members of the team; until they are connected, no figures are estimated or simulated on these pages.</p></aside>
  </>;
}
