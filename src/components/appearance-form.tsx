"use client";
import { useActionState } from "react";
import { updateAppearance } from "@/app/actions/preferences";
import { APPEARANCES, APPEARANCE_LABELS, type Appearance } from "@/lib/appearance";
export function AppearanceForm({ current }: { current: Appearance }) {
  const [state, action, pending] = useActionState(updateAppearance, {});
  // Keyed by the saved value for the same reason as the currency select: React resets the form after the action.
  return <form action={action} className="form appearance-form">
    <fieldset key={current} className="choice-group">
      <legend>Appearance</legend>
      {APPEARANCES.map(value => <label key={value} className="choice">
        <input type="radio" name="appearance" value={value} defaultChecked={value === current} />
        <span className={`swatch swatch-${value}`} aria-hidden="true" />
        <span>{APPEARANCE_LABELS[value]}</span>
      </label>)}
    </fieldset>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Saving…" : "Save appearance"}</button>
  </form>;
}
