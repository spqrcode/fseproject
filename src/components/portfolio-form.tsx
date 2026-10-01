"use client";
import { useActionState } from "react";
import { updatePortfolio } from "@/app/actions/portfolio";
export function PortfolioForm({ name }: { name?: string }) {
  const [state, action, pending] = useActionState(updatePortfolio, {});
  return <form action={action} className="form portfolio-form">
    <div className="field"><label htmlFor="name">Portfolio name</label><input id="name" name="name" required maxLength={80} defaultValue={name} placeholder="My portfolio" /><small>A short name to identify your investments.</small></div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Saving…" : name ? "Save changes" : "Create portfolio"}</button>
  </form>;
}
