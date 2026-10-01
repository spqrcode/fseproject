"use client";
import { useActionState } from "react";
import { logout } from "@/app/actions/auth";
export function SignOut() {
  const [state, action, pending] = useActionState(logout, {});
  return <form action={action}><button className="text-button" disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>{state.error && <p role="alert" className="notice error">{state.error}</p>}</form>;
}
