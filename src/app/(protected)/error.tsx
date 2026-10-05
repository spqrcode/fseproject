"use client";
import Link from "next/link";
// Rendered inside the protected layout, so navigation and sign-out stay available when one section fails.
export default function SectionError({ reset }: { reset: () => void }) {
  return <section className="error-panel" role="alert"><p className="eyebrow">Something went wrong</p><h1>This section could not be loaded.</h1><p>Your data has not been changed. Try again, or continue from the overview.</p><div className="actions"><button className="button" onClick={reset}>Try again</button><Link className="button secondary" href="/dashboard">Go to overview</Link></div></section>;
}
