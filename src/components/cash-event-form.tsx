"use client";

import { useActionState, useState } from "react";
import { addCashEvent, editCashEvent } from "@/app/actions/cash-events";
import { MAX_OCCURRENCES } from "@/lib/recurring-dates";
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
  const [frequency, setFrequency] = useState("once");
  const [repeatEnd, setRepeatEnd] = useState("count");
  const [repeatCount, setRepeatCount] = useState("12");
  const [repeatUntil, setRepeatUntil] = useState("");

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
    {!event && <div className="field">
      <label htmlFor={`event-repeat${suffix}`}>Repeat</label>
      <select id={`event-repeat${suffix}`} name="repeatFrequency" value={frequency} onChange={event => setFrequency(event.target.value)} aria-describedby={`event-repeat-hint${suffix}`}>
        <option value="once">Once</option>
        <option value="monthly">Monthly</option>
        <option value="quarterly">Quarterly</option>
        <option value="annually">Annually</option>
      </select>
      <small id={`event-repeat-hint${suffix}`}>Each occurrence becomes its own event on the same day of the month. A day a month does not have moves to its last day.</small>
    </div>}
    {!event && frequency !== "once" && <div className="field">
      <label htmlFor={`event-repeat-end${suffix}`}>Ends</label>
      <select id={`event-repeat-end${suffix}`} name="repeatEnd" value={repeatEnd} onChange={event => setRepeatEnd(event.target.value)}>
        <option value="count">After a number of times</option>
        <option value="date">On a date</option>
      </select>
    </div>}
    {!event && frequency !== "once" && repeatEnd === "count" && <div className="field">
      <label htmlFor={`event-repeat-count${suffix}`}>Number of times</label>
      <input id={`event-repeat-count${suffix}`} name="repeatCount" type="number" inputMode="numeric" min={2} max={MAX_OCCURRENCES} step={1} required value={repeatCount} onChange={event => setRepeatCount(event.target.value)} aria-describedby={`event-repeat-count-hint${suffix}`} />
      <small id={`event-repeat-count-hint${suffix}`}>From 2 to {MAX_OCCURRENCES}, including the first date.</small>
    </div>}
    {!event && frequency !== "once" && repeatEnd === "date" && <div className="field">
      <label htmlFor={`event-repeat-until${suffix}`}>Last date</label>
      <input id={`event-repeat-until${suffix}`} name="repeatUntil" type="date" required value={repeatUntil} onChange={event => setRepeatUntil(event.target.value)} min={expectedDate || "2000-01-01"} max="2100-12-31" aria-describedby={`event-repeat-until-hint${suffix}`} />
      <small id={`event-repeat-until-hint${suffix}`}>The last occurrence is on or before this date, at most {MAX_OCCURRENCES} in total. Open-ended repeats are not supported.</small>
    </div>}
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Saving…" : event ? "Save event" : "Add cash event"}</button>
  </form>;
}
