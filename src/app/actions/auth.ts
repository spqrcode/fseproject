"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { database } from "@/lib/db";
import { credentialsSchema, type FormState } from "@/lib/validation";
import { hashPassword, verifyPassword, dummyPasswordHash } from "@/lib/password";
import { createSession, revokeSession, SESSION_SECONDS } from "@/lib/session-store";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { verifyOrigin } from "@/lib/request-security";
import { allowAuthAttempt } from "@/lib/rate-limit";

export async function register(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await verifyOrigin();
    if (!await allowAuthAttempt(parsed.data.email)) return { error: "Too many attempts. Try again in 15 minutes." };
    const passwordHash = await hashPassword(parsed.data.password);
    await database().query("INSERT INTO users(email, password_hash) VALUES ($1, $2) ON CONFLICT(email) DO NOTHING", [parsed.data.email, passwordHash]);
    return { success: "If this address was available, your account is ready. You can now sign in." };
  } catch { return { error: "Unable to create an account right now. Please try again." }; }
}

export async function login(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Check your email and password." };
  try {
    await verifyOrigin();
    if (!await allowAuthAttempt(parsed.data.email)) return { error: "Too many attempts. Try again in 15 minutes." };
    const result = await database().query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = $1", [parsed.data.email]);
    const user = result.rows[0];
    const matches = await verifyPassword(parsed.data.password, user?.password_hash ?? dummyPasswordHash);
    if (!user || !matches) return { error: "Check your email and password." };
    await revokeSession(await sessionToken());
    const session = await createSession(user.id);
    (await cookies()).set(SESSION_COOKIE, session.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS, expires: session.expires });
  } catch { return { error: "Unable to sign in right now. Please try again." }; }
  redirect("/dashboard");
}

export async function logout(): Promise<FormState> {
  try {
    await verifyOrigin();
    await revokeSession(await sessionToken());
    (await cookies()).delete(SESSION_COOKIE);
  } catch { return { error: "Unable to sign out right now. Please try again." }; }
  redirect("/login");
}
