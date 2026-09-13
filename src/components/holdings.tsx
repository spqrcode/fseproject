"use client";
import { useActionState } from "react";
import { addHolding, editHolding, removeHolding } from "@/app/actions/holdings";
import type { Holding } from "@/lib/holdings-store";

const AMOUNT = { inputMode: "decimal" as const, autoComplete: "off" as const, maxLength: 21 };

function Notice({ state }: { state: { error?: string; success?: string } }) {
  if (state.error) return <p role="alert" className="notice error">{state.error}</p>;
  if (state.success) return <p role="status" className="notice success">{state.success}</p>;
  return null;
}

export function AddHolding({ ready }: { ready: boolean }) {
  const [state, action, pending] = useActionState(addHolding, {});
  return <form action={action} className="form holding-add">
    <div className="holding-fields">
      <div className="field"><label htmlFor="symbol">Ticker</label>
        <input id="symbol" name="symbol" required maxLength={15} autoComplete="off" placeholder="AAPL" /></div>
      <div className="field"><label htmlFor="quantity">Quantity</label>
        <input id="quantity" name="quantity" required {...AMOUNT} placeholder="10" /></div>
      <div className="field"><label htmlFor="averageBuyPrice">Average purchase price</label>
        <input id="averageBuyPrice" name="averageBuyPrice" required {...AMOUNT} placeholder="185.40" /></div>
    </div>
    <Notice state={state} />
    <button className="button" disabled={pending || !ready}>{pending ? "Adding…" : "Add holding"}</button>
    {!ready && <small className="muted">Name your portfolio first.</small>}
  </form>;
}

function HoldingRow({ holding }: { holding: Holding }) {
  const [saved, save, saving] = useActionState(editHolding, {});
  const [removed, remove, removing] = useActionState(removeHolding, {});
  // Two sibling forms rather than nested ones: a form cannot contain another form.
  // Column names are shown once above the list, so each input carries its own
  // accessible name instead of a repeated visible label.
  return <li className="holding-row">
    <form action={save} className="holding-fields">
      <input type="hidden" name="id" value={holding.id} />
      <input name="symbol" required maxLength={15} autoComplete="off"
        aria-label={`Ticker for ${holding.symbol}`} defaultValue={holding.symbol} />
      <input name="quantity" required {...AMOUNT}
        aria-label={`Quantity for ${holding.symbol}`} defaultValue={holding.quantity} />
      <input name="averageBuyPrice" required {...AMOUNT}
        aria-label={`Average purchase price for ${holding.symbol}`} defaultValue={holding.average_buy_price} />
      <button className="button secondary" disabled={saving}>{saving ? "Saving\u2026" : `Save ${holding.symbol}`}</button>
    </form>
    <form action={remove} className="holding-remove">
      <input type="hidden" name="id" value={holding.id} />
      <button className="text-button" disabled={removing}>{removing ? "Removing\u2026" : `Remove ${holding.symbol}`}</button>
    </form>
    <Notice state={saved} />
    {/* Only a failed removal renders here: a successful one unmounts this row. */}
    <Notice state={removed} />
  </li>;
}

export function HoldingsList({ holdings }: { holdings: Holding[] }) {
  if (!holdings.length) return <p className="muted">No holdings yet. Add your first position above.</p>;
  return <><div className="holdings-head" aria-hidden="true"><span>Ticker</span><span>Quantity</span><span>Average purchase price</span></div>
    <ul className="holdings-list">{holdings.map(holding => <HoldingRow key={holding.id} holding={holding} />)}</ul></>;
}
