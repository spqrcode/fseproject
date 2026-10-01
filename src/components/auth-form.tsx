"use client";
import { useActionState } from "react";
import Link from "next/link";
import { login, register } from "@/app/actions/auth";
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const signingUp = mode === "register";
  const [state, action, pending] = useActionState(signingUp ? register : login, {});
  return <form action={action} className="form">
    <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></div>
    <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete={signingUp ? "new-password" : "current-password"} required minLength={15} maxLength={128} aria-describedby={signingUp ? "password-help" : undefined} />{signingUp && <small id="password-help">Use 15–128 characters. A memorable passphrase works well.</small>}</div>
    {state.error && <p className="notice error" role="alert">{state.error}</p>}
    {state.success && <p className="notice success" role="status">{state.success} <Link href="/login">Sign in</Link></p>}
    <button className="button" disabled={pending}>{pending ? "Please wait…" : signingUp ? "Create account" : "Sign in"}</button>
  </form>;
}
