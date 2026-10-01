import { requireUser, sessionToken } from "@/lib/auth";
import { getPortfolio } from "@/lib/portfolio-store";
import { PortfolioForm } from "@/components/portfolio-form";
export const metadata = { title: "Portfolio" };
export default async function PortfolioPage() {
  await requireUser();
  const portfolio = await getPortfolio(await sessionToken());
  return <><div className="page-heading"><div><h1>Your portfolio</h1><p className="intro">{portfolio ? "Manage your portfolio details." : "Give your portfolio a name to get started."}</p></div></div><section className="settings-section"><div><h2>Portfolio details</h2><p>Only you can access and change this portfolio.</p></div><PortfolioForm name={portfolio?.name} /></section></>;
}
