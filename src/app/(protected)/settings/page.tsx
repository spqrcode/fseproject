import { requireUser, sessionToken } from "@/lib/auth";
import { getReportingCurrency } from "@/lib/preferences-store";
import { listActiveSessions } from "@/lib/account-sessions";
import { DEFAULT_REPORTING_CURRENCY } from "@/lib/currency";
import { formatTimestamp } from "@/lib/format";
import { PageHeading } from "@/components/page-heading";
import { CurrencyForm } from "@/components/currency-form";
import { SignOutOthers } from "@/components/sign-out-others";
export const metadata = { title: "Settings" };
export default async function SettingsPage() {
  await requireUser();
  const token = await sessionToken();
  const [currency, sessions] = await Promise.all([getReportingCurrency(token), listActiveSessions(token)]);
  return <>
    <PageHeading eyebrow="Preferences" title="Settings" intro="Choose how FinTwin Global presents your figures." />
    <section className="settings-section"><div><h2>Reporting currency</h2><p>Totals, forecasts and scenarios will be reported in this currency. Only you can change it.</p></div><CurrencyForm current={currency ?? DEFAULT_REPORTING_CURRENCY} /></section>
    <section className="settings-section" aria-labelledby="sessions-heading">
      <div><h2 id="sessions-heading">Active sessions</h2><p>Every sign-in starts a session that lasts 24 hours. If you signed in on a shared or lost device, sign out of the other sessions here.</p></div>
      <div className="sessions">
        <table className="data-table">
          <caption className="visually-hidden">Your active sessions</caption>
          <thead><tr><th scope="col">Started</th><th scope="col">Expires</th><th scope="col"><span className="visually-hidden">Status</span></th></tr></thead>
          <tbody>{sessions.map((session, index) => <tr key={index}>
            <td className="amount">{formatTimestamp(session.createdAt)}</td>
            <td className="amount">{formatTimestamp(session.expiresAt)}</td>
            <td>{session.current && <span className="state state-ready">This browser</span>}</td>
          </tr>)}</tbody>
        </table>
        <SignOutOthers others={sessions.filter(session => !session.current).length} />
      </div>
    </section>
  </>;
}
