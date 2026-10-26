"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, sessionToken } from "@/lib/auth";
import {
  createCashAccount,
  createCashEvent,
  createCashEvents,
  deleteCashEvent,
  DuplicateAccountNameError,
  listCashEvents,
  setCashEventStatus,
  StatusConflictError,
  updateCashEvent,
} from "@/lib/cash-events-store";
import { MAX_OCCURRENCES, REPEAT_STEP_MONTHS, recurringDates, recurringDatesUntil } from "@/lib/recurring-dates";
import { verifyOrigin } from "@/lib/request-security";
import {
  cashAccountSchema,
  cashEventSchema,
  eventStatusSchema,
  isoDateSchema,
  repeatEndSchema,
  repeatFrequencySchema,
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
  // A form without the field (older page, scripted request) means "once".
  const frequency = repeatFrequencySchema.safeParse(form.get("repeatFrequency") ?? "once");
  if (!accountId.success) return { error: "Choose a valid cash account." };
  if (!event.success) return { error: firstIssue(event.error) };
  if (!frequency.success) return { error: firstIssue(frequency.error) };
  let dates = [event.data.expectedDate];
  if (frequency.data !== "once") {
    const end = repeatEndSchema.safeParse({ mode: form.get("repeatEnd"), count: form.get("repeatCount"), until: form.get("repeatUntil") });
    if (!end.success) return { error: firstIssue(end.error) };
    const start = event.data.expectedDate, step = REPEAT_STEP_MONTHS[frequency.data];
    if (end.data.mode === "date" && end.data.until < start) return { error: "The end date must not be before the first date." };
    dates = end.data.mode === "count" ? recurringDates(start, step, end.data.count) : recurringDatesUntil(start, step, end.data.until);
    if (dates.length > MAX_OCCURRENCES) return { error: `A repeating event can have at most ${MAX_OCCURRENCES} occurrences. Choose an earlier end date.` };
    if (!dates.every(date => isoDateSchema.safeParse(date).success)) return { error: "The last occurrence must be on or before 31 December 2100." };
  }

  try {
    await verifyOrigin();
    const token = await sessionToken();
    const created = dates.length === 1
      ? await createCashEvent(token, accountId.data, event.data)
      : await createCashEvents(token, accountId.data, { description: event.data.description, amount: event.data.amount }, dates);
    if (!created) return { error: "That cash account is unavailable." };
  } catch {
    return { error: "Unable to add the cash event. Please try again." };
  }

  refreshCashPages();
  redirect(dates.length === 1 ? "/cash-events?success=event-added" : "/cash-events?success=events-added");
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

// A status change or a delete that no longer applies (the event was settled or removed in another tab or session)
// is reported to the person instead of being ignored. The redirect happens after the try block because
// redirect() works by throwing.
const UNAVAILABLE = "/cash-events?error=event-unavailable";

export async function changeCashEventStatus(eventId: string, status: string, form: FormData) {
  void form;
  await requireUser();
  const id = uuidSchema.safeParse(eventId);
  const next = eventStatusSchema.safeParse(status);
  if (!id.success || !next.success || next.data === "expected") redirect(UNAVAILABLE);

  let target = UNAVAILABLE;
  try {
    await verifyOrigin();
    const token = await sessionToken();
    // Settling a future-dated event moves its date to today (the date the money moved, decided with #14). Read the
    // date first so the message can say so; it is only used to choose the wording, never to change data.
    const before = next.data === "received" || next.data === "paid"
      ? (await listCashEvents(token)).find(item => item.id === id.data)?.expectedDate
      : undefined;
    const changed = await setCashEventStatus(token, id.data, next.data);
    if (changed) {
      const moved = before !== undefined && before !== changed.expectedDate;
      target = `/cash-events?success=event-${next.data}${moved ? "-today" : ""}`;
    }
  } catch (error) {
    if (!(error instanceof StatusConflictError)) throw error;
  }
  refreshCashPages();
  redirect(target);
}

export async function removeCashEvent(eventId: string, form: FormData) {
  void form;
  await requireUser();
  const id = uuidSchema.safeParse(eventId);
  if (!id.success) redirect(UNAVAILABLE);

  let target = UNAVAILABLE;
  try {
    await verifyOrigin();
    if (await deleteCashEvent(await sessionToken(), id.data)) target = "/cash-events?success=event-deleted";
  } catch (error) {
    if (!(error instanceof StatusConflictError)) throw error;
  }
  refreshCashPages();
  redirect(target);
}
