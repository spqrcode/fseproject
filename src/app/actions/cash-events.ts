"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, sessionToken } from "@/lib/auth";
import {
  createCashAccount,
  createCashEvent,
  deleteCashEvent,
  DuplicateAccountNameError,
  setCashEventStatus,
  StatusConflictError,
  updateCashEvent,
} from "@/lib/cash-events-store";
import { verifyOrigin } from "@/lib/request-security";
import {
  cashAccountSchema,
  cashEventSchema,
  eventStatusSchema,
  uuidSchema,
  type FormState,
} from "@/lib/validation";

function firstIssue(error: { issues: readonly { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the values and try again.";
}

function refreshCashPages() {
  revalidatePath("/cash-events");
  revalidatePath("/dashboard");
}

export async function addCashAccount(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = cashAccountSchema.safeParse({
    name: form.get("name"),
    currency: form.get("currency"),
    openingBalance: form.get("openingBalance"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    await verifyOrigin();
    const created = await createCashAccount(await sessionToken(), parsed.data);
    if (!created) return { error: "Create a workspace before adding a cash account." };
  } catch (error) {
    if (error instanceof DuplicateAccountNameError) return { error: error.message };
    return { error: "Unable to add the cash account. Please try again." };
  }

  refreshCashPages();
  redirect("/cash-events?success=account-added");
}

export async function addCashEvent(_state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const accountId = uuidSchema.safeParse(form.get("accountId"));
  const event = cashEventSchema.safeParse({
    description: form.get("description"),
    amount: form.get("amount"),
    expectedDate: form.get("expectedDate"),
  });
  if (!accountId.success) return { error: "Choose a valid cash account." };
  if (!event.success) return { error: firstIssue(event.error) };

  try {
    await verifyOrigin();
    const created = await createCashEvent(await sessionToken(), accountId.data, event.data);
    if (!created) return { error: "That cash account is unavailable." };
  } catch {
    return { error: "Unable to add the cash event. Please try again." };
  }

  refreshCashPages();
  redirect("/cash-events?success=event-added");
}

export async function editCashEvent(eventId: string, _state: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const id = uuidSchema.safeParse(eventId);
  const event = cashEventSchema.safeParse({
    description: form.get("description"),
    amount: form.get("amount"),
    expectedDate: form.get("expectedDate"),
  });
  if (!id.success) return { error: "That cash event is unavailable." };
  if (!event.success) return { error: firstIssue(event.error) };

  try {
    await verifyOrigin();
    const updated = await updateCashEvent(await sessionToken(), id.data, event.data);
    if (!updated) return { error: "That cash event is unavailable." };
  } catch (error) {
    if (error instanceof StatusConflictError) return { error: "Only expected events can be edited." };
    return { error: "Unable to update the cash event. Please try again." };
  }

  refreshCashPages();
  redirect("/cash-events?success=event-updated");
}

export async function changeCashEventStatus(eventId: string, status: string, form: FormData) {
  void form;
  await requireUser();
  const id = uuidSchema.safeParse(eventId);
  const next = eventStatusSchema.safeParse(status);
  if (!id.success || !next.success || next.data === "expected") return;

  try {
    await verifyOrigin();
    await setCashEventStatus(await sessionToken(), id.data, next.data);
  } catch (error) {
    if (error instanceof StatusConflictError) return;
    throw error;
  }
  refreshCashPages();
}

export async function removeCashEvent(eventId: string, form: FormData) {
  void form;
  await requireUser();
  const id = uuidSchema.safeParse(eventId);
  if (!id.success) return;

  try {
    await verifyOrigin();
    await deleteCashEvent(await sessionToken(), id.data);
  } catch (error) {
    if (error instanceof StatusConflictError) return;
    throw error;
  }
  refreshCashPages();
}
