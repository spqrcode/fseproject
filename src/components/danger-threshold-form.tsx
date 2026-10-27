"use client";

import { useActionState } from "react";
import { updateDangerThreshold } from "@/app/actions/workspace";
import type { ReportingCurrency } from "@/lib/currency";
import { formatMoney } from "@/lib/format";

export function DangerThresholdForm({
  current,
  currency,
}: {
  current: string | null;
  currency: ReportingCurrency;
}) {
  const [state, action, pending] = useActionState(updateDangerThreshold, {});
  const description = current === null
    ? "No custom amount is set. Forecasts currently use 50% of the balance today."
    : `The current custom threshold is ${formatMoney(current, currency)}.`;

  return <form action={action} className="form danger-threshold-form">
    <div className="field">
      <label htmlFor="danger-threshold">Danger threshold ({currency})</label>
      <input
        key={current ?? "default"}
        id="danger-threshold"
        name="dangerThreshold"
        inputMode="decimal"
        maxLength={22}
        defaultValue={current ?? ""}
        placeholder="Leave blank to use the 50% default"
        aria-describedby="danger-threshold-hint danger-threshold-current"
      />
      <small id="danger-threshold-hint">Enter a fixed amount in your reporting currency, with at most two decimal places. Clear the field to restore the default.</small>
      <small id="danger-threshold-current">{description}</small>
    </div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Saving…" : "Save threshold"}</button>
  </form>;
}
