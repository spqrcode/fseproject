export default function Loading() {
  return <div className="loading" role="status"><span className="visually-hidden">Loading this page…</span>
    <div aria-hidden="true"><div className="skeleton skeleton-eyebrow" /><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></div>
  </div>;
}
