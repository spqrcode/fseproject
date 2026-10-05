import { requireUser, sessionToken } from "@/lib/auth";
import { getPortfolio } from "@/lib/portfolio-store";
import { WorkspaceForm } from "@/components/workspace-form";
import { PageHeading } from "@/components/page-heading";
export const metadata = { title: "Workspace" };
export default async function WorkspacePage() {
  await requireUser();
  // Stored in the portfolios table until the workspace schema replaces it.
  const workspace = await getPortfolio(await sessionToken());
  return <><PageHeading eyebrow="Setup" title="Your workspace" intro={workspace ? "Manage your workspace details." : "Give your workspace a name to get started."} /><section className="settings-section"><div><h2>Workspace details</h2><p>Only you can access and change this workspace.</p></div><WorkspaceForm name={workspace?.name} /></section></>;
}
