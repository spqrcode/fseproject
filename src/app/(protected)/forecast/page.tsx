import { requireUser, sessionToken } from "@/lib/auth";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY, currencyLabel } from "@/lib/currency";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ForecastFigure } from "@/components/placeholder-figures";
export const metadata = { title: "Forecast" };
export default async function ForecastPage() {
  await requireUser();
  const currency = await getReportingCurrency(await sessionToken()) ?? DEFAULT_REPORTING_CURRENCY;
  return <>
    <PageHeading eyebrow="Projection" title="Forecast" intro="Projections of your financial position over time." />
    <EmptyState eyebrow="Awaiting the forecast engine" title="The forecast engine is not connected yet." figure={<ForecastFigure />}>
      <p>Once it is delivered, this page will show projected figures in {currencyLabel(currency)}. Nothing here is estimated today, so no number is shown until a real projection exists.</p>
    </EmptyState>
  </>;
}
