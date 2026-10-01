import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { getAppearance } from "@/lib/preferences-store";
import { DEFAULT_APPEARANCE } from "@/lib/appearance";
import { SignOut } from "@/components/sign-out";
import { Navigation } from "@/components/navigation";
import { Brand } from "@/components/brand";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Rendered on the server, so the chosen theme is in the first HTML response and never flashes.
  const appearance = await getAppearance(await sessionToken()) ?? DEFAULT_APPEARANCE;
  return <div className="app-shell" data-theme={appearance}><header className="app-header"><Link href="/dashboard" className="brand-link" aria-label="FinTwin Global overview"><Brand /></Link><Navigation /><div className="account"><span>{user.email}</span><SignOut /></div></header><main id="main" className="workspace">{children}</main><footer className="app-footer"><span>FinTwin Global</span><span>Financial Software Engineering · University project</span></footer></div>;
}
