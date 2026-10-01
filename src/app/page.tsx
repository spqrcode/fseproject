import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionToken } from "@/lib/auth";
import { findSession } from "@/lib/session-store";
import { Brand } from "@/components/brand";

const views = [
  { title: "Today", text: "Your portfolio and reporting currency, stored privately and visible only to you.", state: "Available", tone: "ready" },
  { title: "Forecast", text: "Projections of your financial position over time.", state: "In development", tone: "pending" },
  { title: "Scenarios", text: "What-if comparisons against your base case, including exchange-rate changes.", state: "In development", tone: "pending" },
];
const principles = [
  { title: "No invented numbers", text: "A missing value is shown as unavailable, never as zero, and sections that are not connected yet say so." },
  { title: "Exact amounts", text: "Amounts travel as decimal strings from the database to the screen and are rounded only when they are displayed." },
  { title: "Private by default", text: "Every query is scoped to your own session. Fonts are served by the application itself, with no trackers or third-party font services." },
  { title: "Tested on every change", text: "Unit, database, browser and automated accessibility tests run on every pull request before anything reaches the main branch." },
];

export default async function Home() {
  // Signed-in users go straight to their workspace; everyone else sees what the product is.
  if (await findSession(await sessionToken())) redirect("/dashboard");
  return <div className="landing">
    <header className="landing-header">
      <Link href="/" className="brand-link" aria-label="FinTwin Global home"><Brand /></Link>
      <nav aria-label="Account"><Link href="/login">Sign in</Link><Link className="button" href="/register">Create account</Link></nav>
    </header>
    <main id="main" className="landing-main">
      <section className="landing-hero">
        <svg className="hero-figure" viewBox="0 0 400 260" aria-hidden="true" focusable="false"><circle cx="130" cy="130" r="120" /><circle className="twin" cx="270" cy="130" r="120" /></svg>
        <p className="eyebrow">Financial Software Engineering · University project</p>
        <h1>Your finances, <em>and their twin.</em></h1>
        <p className="intro">FinTwin Global keeps a model of where you stand today next to where you could be: forecasts over time and what-if scenarios, reported in the currency you think in.</p>
        <div className="actions"><Link className="button" href="/register">Create your account</Link><Link className="button secondary" href="/login">Sign in to your workspace</Link></div>
      </section>
      <section className="landing-views" aria-labelledby="views-heading">
        <h2 id="views-heading">Three views of the same money</h2>
        <ol className="view-list">
          {views.map((view, index) => <li key={view.title}>
            <span className="index-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <h3>{view.title}</h3>
            <p>{view.text}</p>
            <p className={`state state-${view.tone}`}>{view.state}</p>
          </li>)}
        </ol>
      </section>
      <section className="landing-principles" aria-labelledby="principles-heading">
        <h2 id="principles-heading">How it is built</h2>
        <dl>{principles.map(item => <div key={item.title}><dt>{item.title}</dt><dd>{item.text}</dd></div>)}</dl>
      </section>
    </main>
    <footer className="app-footer"><span>FinTwin Global</span><span>Financial Software Engineering · University project</span></footer>
  </div>;
}
