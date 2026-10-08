"use client";
import { useActionState } from "react";
import { updateWorkspace } from "@/app/actions/workspace";
export function WorkspaceForm({ name }: { name?: string }) {
  const [state, action, pending] = useActionState(updateWorkspace, {});
  return <form action={action} className="form workspace-form">
    <div className="field"><label htmlFor="name">Workspace name</label><input id="name" name="name" required maxLength={80} defaultValue={name} placeholder="My workspace" aria-describedby="name-hint" /><small id="name-hint">A short name for the finances this workspace models, for example a company or a household.</small></div>
    {state.error && <p role="alert" className="notice error">{state.error}</p>}
    {state.success && <p role="status" className="notice success">{state.success}</p>}
    <button className="button" disabled={pending}>{pending ? "Saving…" : name ? "Save changes" : "Create workspace"}</button>
  </form>;
}
