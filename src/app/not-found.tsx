import Link from "next/link";
export default function NotFound() { return <main id="main" className="error-page"><p className="eyebrow">Error 404</p><h1>Page not found.</h1><p>The address may be mistyped, or the page has moved.</p><Link className="button" href="/dashboard">Go to overview</Link></main>; }
