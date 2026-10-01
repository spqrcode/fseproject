import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt-v1$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, salt, hex, extra] = encoded.split("$");
  if (version !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(hex ?? "") || extra !== undefined) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hex, "hex"));
}
// Unknown accounts still pay the password-hashing cost to reduce timing differences.
export const dummyPasswordHash = `scrypt-v1$${"0".repeat(32)}$${"0".repeat(128)}`;
