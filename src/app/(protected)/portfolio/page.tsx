import { requireUser, sessionToken } from "@/lib/auth";
import { getPortfolio } from "@/lib/portfolio-store";
import { listHoldings } from "@/lib/holdings-store";
import { PortfolioForm } from "@/components/portfolio-form";
import { AddHolding, HoldingsList } from "@/components/holdings";
export const metadata = { title: "Portfolio" };
export default async function PortfolioPage() {
  await requireUser();
  const token = await sessionToken();
  const [portfolio, holdings] = await Promise.all([getPortfolio(token), listHoldings(token)]);
  return <><div className="page-heading"><div><h1>Your portfolio</h1><p className="intro">{portfolio ? "Manage your portfolio details." : "Give your portfolio a name to get started."}</p></div></div>
    <section className="settings-section"><div><h2>Portfolio details</h2><p>Only you can access and change this portfolio.</p></div><PortfolioForm name={portfolio?.name} /></section>
    <section className="settings-section"><div><h2>Holdings</h2><p>Positions you hold, with the quantity and the average price you paid. Market prices are not part of this increment.</p></div>
      <div className="holdings"><AddHolding ready={Boolean(portfolio)} /><HoldingsList holdings={holdings} /></div></section></>;
}
