import { requireUser, sessionToken } from "@/lib/auth";
import { getReportingCurrency } from "@/lib/preferences-store";
import { DEFAULT_REPORTING_CURRENCY } from "@/lib/currency";
import { PageHeading } from "@/components/page-heading";
import { CurrencyForm } from "@/components/currency-form";
export const metadata = { title: "Settings" };
export default async function SettingsPage() {
  await requireUser();
  const currency = await getReportingCurrency(await sessionToken()) ?? DEFAULT_REPORTING_CURRENCY;
  return <>
    <PageHeading eyebrow="Preferences" title="Settings" intro="Choose how FinTwin Global presents your figures." />
    <section className="settings-section"><div><h2>Reporting currency</h2><p>Totals, forecasts and scenarios will be reported in this currency. Only you can change it.</p></div><CurrencyForm current={currency} /></section>
  </>;
}
