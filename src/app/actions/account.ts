"use server";
import { revalidatePath } from "next/cache";
import { requireUser, sessionToken } from "@/lib/auth";
import { revokeOtherSessions } from "@/lib/account-sessions";
import { verifyOrigin } from "@/lib/request-security";
import type { FormState } from "@/lib/validation";
export async function signOutOtherSessions(): Promise<FormState> {
  await requireUser();
  let removed: number;
  try {
    await verifyOrigin();
    removed = await revokeOtherSessions(await sessionToken());
  } catch { return { error: "Unable to sign out your other sessions. Please try again." }; }
  revalidatePath("/settings");
  if (removed === 0) return { success: "No other sessions were active." };
  return { success: `Signed out of ${removed} other ${removed === 1 ? "session" : "sessions"}.` };
}
