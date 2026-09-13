"use server";
import { revalidatePath } from "next/cache";
import { requireUser, sessionToken } from "@/lib/auth";
import { createHolding, deleteHolding, updateHolding, HoldingError, type HoldingFailure } from "@/lib/holdings-store";
import { verifyOrigin } from "@/lib/request-security";
import { holdingIdSchema, holdingSchema, type FormState } from "@/lib/validation";

// "not-found" is deliberately the same answer for another user's holding and for
// an id that never existed, so the form cannot be used to discover holdings.
const MESSAGES: Record<HoldingFailure, string> = {
  auth: "Sign in again to change your holdings.",
  "no-portfolio": "Create a portfolio before adding holdings.",
  duplicate: "That ticker is already in your portfolio. Edit the existing position instead.",
  "not-found": "That holding is no longer available.",
};
const UNAVAILABLE = "Unable to save your holdings right now. Please try again.";

function fields(form: FormData) {
  return { symbol: form.get("symbol"), quantity: form.get("quantity"), averageBuyPrice: form.get("averageBuyPrice") };
}

function refresh() {
  revalidatePath("/portfolio");
  revalidatePath("/dashboard");
}

function failure(error: unknown): FormState {
  return { error: error instanceof HoldingError ? MESSAGES[error.reason] : UNAVAILABLE };
}

export async function addHolding(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = holdingSchema.safeParse(fields(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    // The portfolio is derived from the session inside the store; any portfolio_id
    // submitted with this form is ignored.
    await createHolding(await sessionToken(), parsed.data);
  } catch (error) { return failure(error); }
  refresh();
  return { success: `${parsed.data.symbol} added.` };
}

export async function editHolding(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const id = holdingIdSchema.safeParse(form.get("id"));
  if (!id.success) return { error: MESSAGES["not-found"] };
  const parsed = holdingSchema.safeParse(fields(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    await updateHolding(await sessionToken(), id.data, parsed.data);
  } catch (error) { return failure(error); }
  refresh();
  return { success: `${parsed.data.symbol} updated.` };
}

export async function removeHolding(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const id = holdingIdSchema.safeParse(form.get("id"));
  if (!id.success) return { error: MESSAGES["not-found"] };
  try {
    await verifyOrigin();
    await deleteHolding(await sessionToken(), id.data);
  } catch (error) { return failure(error); }
  refresh();
  return { success: "Holding removed." };
}
