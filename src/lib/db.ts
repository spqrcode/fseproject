import "server-only";
import { Pool } from "pg";
const state = globalThis as typeof globalThis & { portfolioPool?: Pool };
export function database(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  state.portfolioPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 5000 });
  return state.portfolioPool;
}
