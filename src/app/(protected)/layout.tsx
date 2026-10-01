import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SignOut } from "@/components/sign-out";
import { Navigation } from "@/components/navigation";
import { Brand } from "@/components/brand";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <div className="app-shell"><header className="app-header"><Link href="/dashboard" className="brand-link" aria-label="FinTwin Global overview"><Brand /></Link><Navigation /><div className="account"><span>{user.email}</span><SignOut /></div></header><main id="main" className="workspace">{children}</main><footer className="app-footer"><span>FinTwin Global</span><span>Financial Software Engineering · University project</span></footer></div>;
}
