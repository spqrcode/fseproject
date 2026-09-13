import "server-only";
import { database } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/session-store";
import { holdingIdSchema, holdingSchema, type HoldingInput } from "@/lib/validation";

// numeric columns are returned as strings by pg. They stay strings here so no
// precision is lost before the valuation work in a later increment.
export type Holding = { id: string; symbol: string; quantity: string; average_buy_price: string; updated_at: Date };

export type HoldingFailure = "auth" | "no-portfolio" | "duplicate" | "not-found";
export class HoldingError extends Error {
  constructor(readonly reason: HoldingFailure) { super(reason); }
}

const DUPLICATE_KEY = "23505";
function isDuplicate(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === DUPLICATE_KEY;
}

// Every statement below reaches holdings only through the caller's own unexpired
// session, so a forged portfolio or holding id simply matches no row.
function session(token: string | undefined) {
  if (!token || !validToken(token)) throw new HoldingError("auth");
  return tokenHash(token);
}

// A malformed id would otherwise raise a PostgreSQL cast error instead of the
// same answer an unknown id gets.
function identifier(id: string) {
  const parsed = holdingIdSchema.safeParse(id);
  if (!parsed.success) throw new HoldingError("not-found");
  return parsed.data;
}

export async function listHoldings(token: string | undefined): Promise<Holding[]> {
  if (!token || !validToken(token)) return [];
  const result = await database().query<Holding>(
    `SELECT h.id, h.symbol, h.quantity, h.average_buy_price, h.updated_at
     FROM holdings h
     JOIN portfolios p ON p.id = h.portfolio_id
     JOIN sessions s ON s.user_id = p.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
     ORDER BY h.symbol`, [session(token)]);
  return result.rows;
}

export async function createHolding(token: string | undefined, input: unknown) {
  const holding: HoldingInput = holdingSchema.parse(input);
  const digest = session(token);
  let result;
  try {
    // portfolio_id is selected from the session, never accepted from the caller.
    result = await database().query(
      `INSERT INTO holdings(portfolio_id, symbol, quantity, average_buy_price)
       SELECT p.id, $2, $3, $4
       FROM portfolios p
       JOIN sessions s ON s.user_id = p.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
       RETURNING id`, [digest, holding.symbol, holding.quantity, holding.averageBuyPrice]);
  } catch (error) {
    if (isDuplicate(error)) throw new HoldingError("duplicate");
    throw error;
  }
  // requireUser has already checked the session, so no row means the signed-in
  // user has no portfolio yet (or the session expired in between). Nothing is written.
  if (result.rowCount !== 1) throw new HoldingError("no-portfolio");
}

export async function updateHolding(token: string | undefined, id: string, input: unknown) {
  const holding: HoldingInput = holdingSchema.parse(input);
  const digest = session(token);
  const holdingId = identifier(id);
  let result;
  try {
    // portfolio_id is absent from SET, so a holding cannot be moved to another portfolio.
    result = await database().query(
      `UPDATE holdings h
       SET symbol = $3, quantity = $4, average_buy_price = $5, updated_at = now()
       FROM portfolios p, sessions s
       WHERE h.id = $2 AND p.id = h.portfolio_id AND s.user_id = p.user_id
         AND s.token_hash = $1 AND s.expires_at > now()`,
      [digest, holdingId, holding.symbol, holding.quantity, holding.averageBuyPrice]);
  } catch (error) {
    if (isDuplicate(error)) throw new HoldingError("duplicate");
    throw error;
  }
  // Someone else's id and an unknown id both reach this line, so neither can be
  // told apart from the outside.
  if (result.rowCount !== 1) throw new HoldingError("not-found");
}

export async function deleteHolding(token: string | undefined, id: string) {
  const digest = session(token);
  const holdingId = identifier(id);
  const result = await database().query(
    `DELETE FROM holdings h
     USING portfolios p, sessions s
     WHERE h.id = $2 AND p.id = h.portfolio_id AND s.user_id = p.user_id
       AND s.token_hash = $1 AND s.expires_at > now()`, [digest, holdingId]);
  if (result.rowCount !== 1) throw new HoldingError("not-found");
}
