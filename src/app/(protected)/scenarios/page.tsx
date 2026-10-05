import { requireUser, sessionToken } from "@/lib/auth";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ScenarioFigure } from "@/components/placeholder-figures";
export const metadata = { title: "Scenario lab" };
export default async function ScenariosPage() {
  await requireUser();
  const currency = await getReportingCurrency(await sessionToken()) ?? DEFAULT_REPORTING_CURRENCY;
  return <>
    <PageHeading eyebrow="What if" title="Scenario lab" intro="What-if analysis against your base case, including exchange-rate shocks." />
    <EmptyState eyebrow="Awaiting scenario analysis" title="The scenario lab is not connected yet." figure={<ScenarioFigure />}>
      <p>Once it is delivered, you will compare scenarios such as a delayed invoice or an exchange-rate shock against your base case, in {currencyLabel(currency)}. Every result will say how fresh its exchange rate is. No scenario is simulated today.</p>
    </EmptyState>
  </>;
}
