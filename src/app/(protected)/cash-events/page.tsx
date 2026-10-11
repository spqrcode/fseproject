import Link from "next/link";
import { requireUser, sessionToken } from "@/lib/auth";
import { listCashAccounts, listCashEvents } from "@/lib/cash-events-store";
import { getWorkspace } from "@/lib/workspace-store";
import { formatMoney } from "@/lib/format";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { CashEventsFigure } from "@/components/placeholder-figures";
import { CashAccountForm } from "@/components/cash-account-form";
import { CashEventForm } from "@/components/cash-event-form";
import { CashEventActions } from "@/components/cash-event-actions";
export const metadata = { title: "Cash events" };
const successMessages: Record<string, string> = {
  "account-added": "Cash account added.",
  "event-added": "Cash event added.",
  "event-updated": "Cash event updated.",
};

export default async function CashEventsPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  await requireUser();
  const success = successMessages[(await searchParams).success ?? ""];
  const token = await sessionToken();
  const [workspace, accounts, events] = await Promise.all([
    getWorkspace(token),
    listCashAccounts(token),
    listCashEvents(token),
  ]);
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const accountOptions = accounts.map(({ id, name, currency }) => ({ id, name, currency }));

  return <>
    <PageHeading eyebrow="Inflows and outflows" title="Cash events" intro="Planned income and expenses by date, the input to every forecast and scenario." />
    {success && <p role="status" className="notice success page-notice">{success}</p>}

    {!workspace ? <EmptyState eyebrow="Workspace required" title="Create your workspace first." figure={<CashEventsFigure />}>
      <p>Cash accounts and events belong to a workspace. Set one up before recording the money you expect to receive or pay.</p>
      <p className="empty-action"><Link className="button" href="/workspace">Create workspace</Link></p>
    </EmptyState> : <div className="cash-layout">
      <aside className="cash-sidebar">
        <section className="cash-panel" aria-labelledby="accounts-heading">
          <p className="eyebrow">Accounts</p>
          <h2 id="accounts-heading">Where cash is held</h2>
          {accounts.length > 0 && <ul className="account-list">
            {accounts.map(account => <li key={account.id}>
              <span><strong>{account.name}</strong><small>{account.currency}</small></span>
              <span className="amount">{formatMoney(account.openingBalance, account.currency)}</span>
            </li>)}
          </ul>}
          <CashAccountForm hasAccounts={accounts.length > 0} />
        </section>

        {accounts.length > 0 && <section className="cash-panel" aria-labelledby="new-event-heading">
          <p className="eyebrow">New event</p>
          <h2 id="new-event-heading">Record expected cash</h2>
          <CashEventForm accounts={accountOptions} />
        </section>}
      </aside>

      <section className="event-section" aria-labelledby="event-list-heading">
        <div className="index-head">
          <h2 id="event-list-heading">Event schedule</h2>
          <p className="eyebrow">{events.length} {events.length === 1 ? "event" : "events"}</p>
        </div>
        {events.length === 0 ? <div className="event-empty">
          <p>No cash events yet.</p>
          <p className="muted">Add an expected income or expense to begin the schedule.</p>
        </div> : <ol className="event-list">
          {events.map(event => <li key={event.id} className="event-card">
            <div className="event-date"><span>{event.expectedDate}</span><small>{accountNames.get(event.accountId) ?? "Cash account"}</small></div>
            <div className="event-description"><h3>{event.description}</h3><p className={`event-status status-${event.status}`}>{event.status}</p></div>
            <p className={`event-amount amount ${event.amount.startsWith("-") ? "expense" : "income"}`}>{formatMoney(event.amount, event.currency, { signed: true })}</p>
            {event.status === "expected" && <div className="event-controls">
              <CashEventActions eventId={event.id} amount={event.amount} />
              <details className="editor compact">
                <summary>Edit</summary>
                <CashEventForm event={event} />
              </details>
            </div>}
          </li>)}
        </ol>}
      </section>
    </div>}
  </>;
}
