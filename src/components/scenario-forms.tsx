"use client";

import { useActionState, useState } from "react";
import { addInvoiceDelay, addScenario, saveFxShock } from "@/app/actions/scenarios";

export function ScenarioForm() {
  const [state, action, pending] = useActionState(addScenario, {});
  const [name, setName] = useState("");
  return <form action={action} className="form scenario-form">
    <div className="field">
      <label htmlFor="scenario-name">Scenario name</label>
      <input id="scenario-name" name="name" required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Invoice arrives two weeks late" />
    </div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    <button className="button" disabled={pending}>{pending ? "Creating…" : "Create scenario"}</button>
  </form>;
}

type InvoiceOption = { id: string; description: string; expectedDate: string };

export function DelayForm({ scenarioId, invoices }: { scenarioId: string; invoices: readonly InvoiceOption[] }) {
  const [state, action, pending] = useActionState(addInvoiceDelay, {});
  const [cashEventId, setCashEventId] = useState(invoices[0]?.id ?? "");
  const [dateOverride, setDateOverride] = useState("");
  return <form action={action} className="form scenario-form">
    <input type="hidden" name="scenarioId" value={scenarioId} />
    <div className="field">
      <label htmlFor="delay-invoice">Expected invoice</label>
      <select id="delay-invoice" name="cashEventId" value={cashEventId} onChange={event => setCashEventId(event.target.value)} required>
        {invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.description} · {invoice.expectedDate}</option>)}
      </select>
    </div>
    <div className="field">
      <label htmlFor="delay-date">New expected date</label>
      <input id="delay-date" type="date" name="dateOverride" required min="2000-01-01" max="2100-12-31" value={dateOverride} onChange={event => setDateOverride(event.target.value)} />
      <small>Later than the original date. The real cash event will not change.</small>
    </div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    <button className="button" disabled={pending || invoices.length === 0}>{pending ? "Saving…" : "Delay invoice in scenario"}</button>
  </form>;
}

export function SaveShockForm({ scenarioId, snapshotId, shockPercent }: { scenarioId: string; snapshotId: string; shockPercent: string }) {
  const [state, action, pending] = useActionState(saveFxShock, {});
  return <form action={action} className="scenario-save-shock">
    <input type="hidden" name="scenarioId" value={scenarioId} />
    <input type="hidden" name="snapshotId" value={snapshotId} />
    <input type="hidden" name="shockPercent" value={shockPercent} />
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    <button className="button secondary" disabled={pending}>{pending ? "Saving…" : "Save shock to scenario"}</button>
  </form>;
}
