"use client";

import { useActionState, useState } from "react";
import { addCashEvent, editCashEvent } from "@/app/actions/cash-events";
type AccountOption = { id: string; name: string; currency: string };

type EditableEvent = {
  id: string;
  description: string;
  amount: string;
  expectedDate: string;
};

export function CashEventForm({ accounts = [], event }: { accounts?: readonly AccountOption[]; event?: EditableEvent }) {
  const update = event ? editCashEvent.bind(null, event.id) : addCashEvent;
  const [state, action, pending] = useActionState(update, {});
  const suffix = event ? `-${event.id}` : "-new";
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [amount, setAmount] = useState(event?.amount ?? "");
  const [expectedDate, setExpectedDate] = useState(event?.expectedDate ?? "");

  return <form action={action} className="form cash-form">
    {!event && <div className="field">
      <label htmlFor={`event-account${suffix}`}>Cash account</label>
      <select id={`event-account${suffix}`} name="accountId" value={accountId} onChange={event => setAccountId(event.target.value)} required>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
      </select>
    </div>}
    <div className="field">
      <label htmlFor={`event-description${suffix}`}>Description</label>
      <input id={`event-description${suffix}`} name="description" required maxLength={200} value={description} onChange={event => setDescription(event.target.value)} placeholder="Customer invoice" />
    </div>
    <div className="field">
      <label htmlFor={`event-amount${suffix}`}>Signed amount</label>
      <input id={`event-amount${suffix}`} name="amount" required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="1250.00 or -80.00" aria-describedby={`event-amount-hint${suffix}`} />
      <small id={`event-amount-hint${suffix}`}>Income is positive, expenses are negative, and zero is not allowed.</small>
    </div>
    <div className="field">
      <label htmlFor={`event-date${suffix}`}>Expected date</label>
      <input id={`event-date${suffix}`} name="expectedDate" type="date" required value={expectedDate} onChange={event => setExpectedDate(event.target.value)} min="2000-01-01" max="2100-12-31" />
    </div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Saving…" : event ? "Save event" : "Add cash event"}</button>
  </form>;
}
