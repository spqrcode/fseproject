import { requireUser, sessionToken } from "@/lib/auth";
import { getDangerThreshold, getWorkspace } from "@/lib/workspace-store";
import { getPreferences } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY } from "@/lib/currency";
import { WorkspaceForm } from "@/components/workspace-form";
import { DangerThresholdForm } from "@/components/danger-threshold-form";
import { PageHeading } from "@/components/page-heading";
export const metadata = { title: "Workspace" };
export default async function WorkspacePage() {
  await requireUser();
  const token = await sessionToken();
  const [workspace, threshold, preferences] = await Promise.all([
    getWorkspace(token),
    getDangerThreshold(token),
    getPreferences(token),
  ]);
  const currency = preferences?.reportingCurrency ?? DEFAULT_REPORTING_CURRENCY;
  return <>
    <PageHeading eyebrow="Setup" title="Your workspace" intro={workspace ? "Manage your workspace details and liquidity warning." : "Give your workspace a name to get started."} />
    <section className="settings-section"><div><h2>Workspace details</h2><p>Only you can access and change this workspace.</p></div><WorkspaceForm name={workspace?.name} /></section>
    {workspace && <section className="settings-section" aria-labelledby="danger-threshold-heading">
      <div>
        <h2 id="danger-threshold-heading">Danger threshold</h2>
        <p>Set the minimum cash buffer you want to keep. Liquidity warnings begin only when an end-of-day balance falls below this amount.</p>
      </div>
      <DangerThresholdForm current={threshold?.dangerThreshold ?? null} currency={currency} />
    </section>}
  </>;
}
