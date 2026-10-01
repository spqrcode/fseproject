import { requireUser, sessionToken } from "@/lib/auth";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ScenarioFigure } from "@/components/placeholder-figures";
export const metadata = { title: "Scenarios" };
export default async function ScenariosPage() {
  await requireUser();
  const currency = await getReportingCurrency(await sessionToken()) ?? DEFAULT_REPORTING_CURRENCY;
  return <>
    <PageHeading eyebrow="What if" title="Scenarios" intro="What-if analysis, including exchange-rate changes." />
    <EmptyState eyebrow="Awaiting scenario analysis" title="Scenario analysis is not connected yet." figure={<ScenarioFigure />}>
      <p>Once it is delivered, this page will compare scenarios against your base case in {currencyLabel(currency)}. No scenario is simulated today.</p>
    </EmptyState>
  </>;
}
