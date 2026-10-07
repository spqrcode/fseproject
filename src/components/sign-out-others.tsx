"use client";
import { useActionState } from "react";
import { signOutOtherSessions } from "@/app/actions/account";
export function SignOutOthers({ others }: { others: number }) {
  const [state, action, pending] = useActionState(signOutOtherSessions, {});
  const label = others === 0 ? "No other sessions" : `Sign out of ${others} other ${others === 1 ? "session" : "sessions"}`;
  return <form action={action} className="form sessions-form">
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button secondary" disabled={pending || others === 0}>{pending ? "Signing out…" : label}</button>
  </form>;
}
