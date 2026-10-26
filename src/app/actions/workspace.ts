"use server";
import { revalidatePath } from "next/cache";
import { requireUser, sessionToken } from "@/lib/auth";
import { saveDangerThreshold, saveWorkspace } from "@/lib/workspace-store";
import { verifyOrigin } from "@/lib/request-security";
import { dangerThresholdSchema, workspaceNameSchema, type FormState } from "@/lib/validation";
export async function updateWorkspace(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = workspaceNameSchema.safeParse(form.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    await saveWorkspace(await sessionToken(), parsed.data);
  } catch { return { error: "Unable to save your workspace. Please try again." }; }
  revalidatePath("/workspace");
  revalidatePath("/dashboard");
  return { success: "Workspace saved." };
}

export async function updateDangerThreshold(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const raw = form.get("dangerThreshold");
  // An empty field explicitly clears the stored amount so the engine can apply its 50% default.
  const input = typeof raw === "string" && raw.trim() === "" ? null : raw;
  const parsed = dangerThresholdSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    if (!await saveDangerThreshold(await sessionToken(), parsed.data)) {
      return { error: "Create your workspace before setting a danger threshold." };
    }
  } catch { return { error: "Unable to save the danger threshold. Please try again." }; }
  revalidatePath("/workspace");
  revalidatePath("/dashboard");
  revalidatePath("/scenarios");
  return { success: parsed.data === null ? "Default danger threshold restored." : "Danger threshold saved." };
}
