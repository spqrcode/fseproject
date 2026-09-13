import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findSession } from "@/lib/session-store";
export const SESSION_COOKIE = "portfolio_session";
export async function sessionToken() { return (await cookies()).get(SESSION_COOKIE)?.value; }
export async function requireUser() {
  const user = await findSession(await sessionToken());
  if (!user) redirect("/login");
  return user;
}
