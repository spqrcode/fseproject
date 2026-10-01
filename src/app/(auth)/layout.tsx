import { Brand } from "@/components/brand";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell">
    <aside className="auth-aside" aria-label="About FinTwin Global">
      <Brand />
      <div>
        <p className="auth-statement">Your finances, <em>and their twin.</em></p>
        <p className="auth-sub">Model where you stand today and where you could be tomorrow, in the currency you think in.</p>
      </div>
      <p className="eyebrow">Financial Software Engineering · University project</p>
      <svg className="auth-figure" viewBox="0 0 400 260" aria-hidden="true" focusable="false"><circle cx="130" cy="130" r="120" /><circle className="twin" cx="270" cy="130" r="120" /></svg>
    </aside>
    <main id="main" className="auth-main">{children}</main>
  </div>;
}
