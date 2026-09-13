import { requireUser } from "@/lib/auth";
import { SignOut } from "@/components/sign-out";
import { Navigation } from "@/components/navigation";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <div className="app-shell"><header className="app-header"><span className="brand">Portfolio<span className="brand-dot">.</span></span><Navigation /><div className="account"><span>{user.email}</span><SignOut /></div></header><main id="main" className="workspace">{children}</main><footer className="app-footer">Financial Software Engineering <span>University project</span></footer></div>;
}
