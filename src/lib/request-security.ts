import "server-only";
import { headers } from "next/headers";
export async function verifyOrigin() {
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new Error("APP_ORIGIN is not configured.");
  const origin = (await headers()).get("origin");
  if (origin !== new URL(expected).origin) throw new Error("Request origin rejected.");
}
