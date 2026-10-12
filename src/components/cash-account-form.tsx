"use client";

import { useActionState, useState } from "react";
import { addCashAccount } from "@/app/actions/cash-events";
import { REPORTING_CURRENCIES, currencyLabel } from "@/lib/currency";

export function CashAccountForm({ hasAccounts }: { hasAccounts: boolean }) {
  const [state, action, pending] = useActionState(addCashAccount, {});
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [openingBalance, setOpeningBalance] = useState("0");
  const keepOpen = !hasAccounts || Boolean(state.error) || Boolean(state.success);
  return <details className="editor" open={keepOpen}>
    <summary>{hasAccounts ? "Add another account" : "Add your first cash account"}</summary>
    <form action={action} className="form cash-form">
    <div className="field">
      <label htmlFor="account-name">Account name</label>
      <input id="account-name" name="name" required maxLength={80} placeholder="Operating account" value={name} onChange={event => setName(event.target.value)} />
    </div>
    <div className="field">
      <label htmlFor="account-currency">Currency</label>
      <select id="account-currency" name="currency" value={currency} onChange={event => setCurrency(event.target.value)}>
        {REPORTING_CURRENCIES.map(currency => <option key={currency} value={currency}>{currencyLabel(currency)}</option>)}
      </select>
      <small>An account keeps one currency so its events cannot disagree with it.</small>
    </div>
    <div className="field">
      <label htmlFor="opening-balance">Opening balance</label>
      <input id="opening-balance" name="openingBalance" required inputMode="decimal" value={openingBalance} onChange={event => setOpeningBalance(event.target.value)} aria-describedby="opening-balance-hint" />
      <small id="opening-balance-hint">A plain amount with at most two decimal places. Negative balances are allowed.</small>
    </div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Adding…" : "Add cash account"}</button>
    </form>
  </details>;
}
