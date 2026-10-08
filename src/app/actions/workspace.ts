"use server";
import { revalidatePath } from "next/cache";
import { requireUser, sessionToken } from "@/lib/auth";
import { saveWorkspace } from "@/lib/workspace-store";
import { verifyOrigin } from "@/lib/request-security";
import { workspaceNameSchema, type FormState } from "@/lib/validation";
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
