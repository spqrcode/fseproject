export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell"><header className="auth-header"><span className="brand">Portfolio<span className="brand-dot">.</span></span><span className="muted">Risk Dashboard</span></header><main id="main" className="auth-main">{children}</main><footer className="auth-footer">Financial Software Engineering · University project</footer></div>;
}
