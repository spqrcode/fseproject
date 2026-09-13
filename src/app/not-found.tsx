import Link from "next/link";
export default function NotFound() { return <main id="main" className="error-page"><h1>Page not found.</h1><Link className="button" href="/dashboard">Go to overview</Link></main>; }
