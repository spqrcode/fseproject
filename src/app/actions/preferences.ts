"use server";
import { revalidatePath } from "next/cache";
import { requireUser, sessionToken } from "@/lib/auth";
import { saveReportingCurrency } from "@/lib/preferences-store";
import { verifyOrigin } from "@/lib/request-security";
import { reportingCurrencySchema, type FormState } from "@/lib/validation";
export async function updateReportingCurrency(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = reportingCurrencySchema.safeParse(form.get("currency"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    await saveReportingCurrency(await sessionToken(), parsed.data);
  } catch { return { error: "Unable to save your settings. Please try again." }; }
  revalidatePath("/", "layout");
  return { success: "Reporting currency saved." };
}
