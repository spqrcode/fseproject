import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { getPortfolio } from "@/lib/portfolio-store";
export const metadata = { title: "Overview" };
export default async function Dashboard() {
  await requireUser();
  const portfolio = await getPortfolio(await sessionToken());
  return <><div className="page-heading"><div><h1>Overview</h1><p className="intro">{portfolio ? portfolio.name : "Your portfolio starts here."}</p></div><Link className="button secondary" href="/portfolio">{portfolio ? "Manage portfolio" : "Create portfolio"}<span aria-hidden="true">↗</span></Link></div>
    <section className="empty-state"><span className="empty-symbol" aria-hidden="true">＋</span><h2>{portfolio ? "Your portfolio is ready." : "Make room for your investments."}</h2><p>{portfolio ? "Your account and portfolio are saved. Holdings and market prices will be added in the next project increment." : "Create a portfolio to give your investments a home. You can change its name at any time."}</p>{!portfolio && <Link className="button" href="/portfolio">Create your portfolio</Link>}</section>
    <section className="scope-note"><h2>About this version</h2><p>Account access and portfolio setup are available. Valuation, profit/loss, and allocation will appear once holdings and market data are implemented.</p></section></>;
}
