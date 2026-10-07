"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main id="main" className="error-page"><p className="eyebrow">Error</p><h1>Something went wrong.</h1><p>We couldn’t load this page. Please try again in a moment.</p><button className="button" onClick={reset}>Try again</button></main>;
}
