"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, sessionToken } from "@/lib/auth";
import { addDelayAdjustment, createScenario, DuplicateDelayAdjustmentError } from "@/lib/scenario-store";
import { addScenarioFxShock } from "@/lib/fx/shock-store";
import { InvalidShockPercentageError } from "@/lib/fx/fx-shock";
import { verifyOrigin } from "@/lib/request-security";
import { isoDateSchema, scenarioNameSchema, uuidSchema, type FormState } from "@/lib/validation";

function firstIssue(error: { issues: readonly { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the values and try again.";
}

export async function addScenario(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const name = scenarioNameSchema.safeParse(form.get("name"));
  if (!name.success) return { error: firstIssue(name.error) };

  let id: string;
  try {
    await verifyOrigin();
    id = (await createScenario(await sessionToken(), name.data)).id;
  } catch {
    return { error: "Unable to create the scenario. Check that your workspace is ready." };
  }
  revalidatePath("/scenarios");
  redirect(`/scenarios?scenario=${id}&success=scenario-added`);
}

export async function addInvoiceDelay(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const scenarioId = uuidSchema.safeParse(form.get("scenarioId"));
  const cashEventId = uuidSchema.safeParse(form.get("cashEventId"));
  const dateOverride = isoDateSchema.safeParse(form.get("dateOverride"));
  if (!scenarioId.success || !cashEventId.success) return { error: "Choose a valid scenario and expected invoice." };
  if (!dateOverride.success) return { error: firstIssue(dateOverride.error) };

  try {
    await verifyOrigin();
    await addDelayAdjustment(await sessionToken(), scenarioId.data, cashEventId.data, dateOverride.data);
  } catch (error) {
    if (error instanceof DuplicateDelayAdjustmentError) return { error: error.message };
    return { error: "Choose an expected income event and a date later than its original date." };
  }
  revalidatePath("/scenarios");
  redirect(`/scenarios?scenario=${scenarioId.data}&success=delay-added`);
}

export async function saveFxShock(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const scenarioId = uuidSchema.safeParse(form.get("scenarioId"));
  const snapshotId = uuidSchema.safeParse(form.get("snapshotId"));
  const shockPercent = form.get("shockPercent");
  if (!scenarioId.success || !snapshotId.success || typeof shockPercent !== "string") {
    return { error: "Choose a valid scenario, snapshot and percentage." };
  }

  try {
    await verifyOrigin();
    await addScenarioFxShock(await sessionToken(), scenarioId.data, snapshotId.data, shockPercent);
  } catch (error) {
    if (error instanceof InvalidShockPercentageError) return { error: "Enter a percentage greater than -100." };
    return { error: "Unable to save this shock. It may already be saved in the scenario." };
  }
  revalidatePath("/scenarios");
  redirect(`/scenarios?scenario=${scenarioId.data}&success=shock-added`);
}
