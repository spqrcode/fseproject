"use client";
import { useActionState, useState } from "react";
import { updateReportingCurrency } from "@/app/actions/preferences";
import { REPORTING_CURRENCIES, currencyLabel, type ReportingCurrency } from "@/lib/currency";
import { formatMoney } from "@/lib/format";
export function CurrencyForm({ current }: { current: ReportingCurrency }) {
  const [state, action, pending] = useActionState(updateReportingCurrency, {});
  const [preview, setPreview] = useState<ReportingCurrency>(current);
  // React resets an action form when the action finishes, which puts a select back on its default option.
  // Keying the select by the saved currency remounts it with the new default after a save, and onReset keeps
  // the example in line with what the select shows (the saved value) when a save fails.
  return <form action={action} onReset={() => setPreview(current)} className="form currency-form">
    <div className="field"><label htmlFor="currency">Reporting currency</label>
      <select key={current} id="currency" name="currency" defaultValue={current} onChange={event => setPreview(event.target.value as ReportingCurrency)} aria-describedby="currency-example">
        {REPORTING_CURRENCIES.map(code => <option key={code} value={code}>{currencyLabel(code)}</option>)}
      </select>
      <small id="currency-example">Example: <span className="amount">{formatMoney("1234.56", preview)}</span></small>
    </div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Saving…" : "Save currency"}</button>
  </form>;
}
