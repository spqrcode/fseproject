import { requireUser } from "@/lib/auth";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { CashEventsFigure } from "@/components/placeholder-figures";
export const metadata = { title: "Cash events" };
export default async function CashEventsPage() {
  await requireUser();
  return <>
    <PageHeading eyebrow="Inflows and outflows" title="Cash events" intro="Planned income and expenses by date, the input to every forecast and scenario." />
    <EmptyState eyebrow="Awaiting cash event storage" title="Cash events are not connected yet." figure={<CashEventsFigure />}>
      <p>Once events are stored for your workspace, they will be listed here by date, each in its own currency: income as a positive amount, expenses as a negative one. A cancelled or completed event leaves the forecast and keeps a note saying so. No event is shown until a real one exists.</p>
    </EmptyState>
  </>;
}
