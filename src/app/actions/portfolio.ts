"use server";
import { revalidatePath } from "next/cache";
import { requireUser, sessionToken } from "@/lib/auth";
import { savePortfolio } from "@/lib/portfolio-store";
import { verifyOrigin } from "@/lib/request-security";
import { portfolioNameSchema, type FormState } from "@/lib/validation";
export async function updatePortfolio(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = portfolioNameSchema.safeParse(form.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    await savePortfolio(await sessionToken(), parsed.data);
  } catch { return { error: "Unable to save your workspace. Please try again." }; }
  revalidatePath("/workspace");
  revalidatePath("/dashboard");
  return { success: "Workspace saved." };
}
