import { requireUser, sessionToken } from "@/lib/auth";
import { getPortfolio } from "@/lib/portfolio-store";
import { PortfolioForm } from "@/components/portfolio-form";
import { PageHeading } from "@/components/page-heading";
export const metadata = { title: "Portfolio" };
export default async function PortfolioPage() {
  await requireUser();
  const portfolio = await getPortfolio(await sessionToken());
  return <><PageHeading eyebrow="Setup" title="Your portfolio" intro={portfolio ? "Manage your portfolio details." : "Give your portfolio a name to get started."} /><section className="settings-section"><div><h2>Portfolio details</h2><p>Only you can access and change this portfolio.</p></div><PortfolioForm name={portfolio?.name} /></section></>;
}
