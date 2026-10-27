"use server";
import { revalidatePath } from "next/cache";
import { requireUser, sessionToken } from "@/lib/auth";
import { saveAppearance, saveReportingCurrency } from "@/lib/preferences-store";
import { verifyOrigin } from "@/lib/request-security";
import { appearanceSchema, reportingCurrencySchema, type FormState } from "@/lib/validation";
export async function updateReportingCurrency(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = reportingCurrencySchema.safeParse(form.get("currency"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    const thresholdCleared = await saveReportingCurrency(await sessionToken(), parsed.data);
    revalidatePath("/", "layout");
    return { success: thresholdCleared
      ? "Reporting currency saved. Set a new danger threshold for this currency."
      : "Reporting currency saved." };
  } catch { return { error: "Unable to save your settings. Please try again." }; }
}
export async function updateAppearance(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = appearanceSchema.safeParse(form.get("appearance"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    await saveAppearance(await sessionToken(), parsed.data);
  } catch { return { error: "Unable to save your settings. Please try again." }; }
  revalidatePath("/", "layout");
  return { success: "Appearance saved." };
}
