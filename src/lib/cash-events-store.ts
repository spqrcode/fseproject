import "server-only";
import { database } from "@/lib/db";
import { hasValidSession, tokenHash, validToken } from "@/lib/session-store";
import { type CashEventStatus } from "@/lib/cash-event-status";
import { type ReportingCurrency } from "@/lib/currency";
import { accountNameSchema, cashAccountSchema, cashEventSchema, eventStatusSchema, isoDateSchema, uuidSchema } from "@/lib/validation";

export type CashAccount = { id: string; name: string; currency: ReportingCurrency; openingBalance: string; createdAt: Date };
export type CashEvent = {
  id: string; accountId: string; description: string; amount: string; currency: ReportingCurrency;
  expectedDate: string; status: CashEventStatus; createdAt: Date; updatedAt: Date;
};

// Raised for the caller's own data, so it reveals nothing about anyone else's.
export class DuplicateAccountNameError extends Error { constructor() { super("An account with this name already exists."); } }
export class StatusConflictError extends Error { constructor() { super("This change conflicts with the event's status."); } }

// Every query below starts at the session token and reaches data only through
// sessions (unexpired) -> workspaces -> cash_accounts / cash_events. No workspace, owner or user id is ever
// taken from input. Rows of other users and rows that do not exist are the same thing to the caller.
//
// Results: lists are empty without a session. A single row, or `false` for delete, comes back as null / false
// when it is not the caller's, does not exist, or the id is malformed. A missing or expired session throws
// "Authentication required." instead; that is checked only after a query found nothing.
export async function notFound(token: string | undefined): Promise<null> {
  if (!await hasValidSession(token)) throw new Error("Authentication required.");
  return null;
}
// True when the event exists and belongs to the caller, whatever its status. Used after a change touched
// nothing, to tell "yours but not allowed" (StatusConflictError) from "not yours or not there" (null).
async function ownsEvent(token: string, eventId: string): Promise<boolean> {
  const result = await database().query(`SELECT 1 FROM cash_events e JOIN workspaces w ON w.id = e.workspace_id
    JOIN sessions s ON s.user_id = w.user_id WHERE e.id = $2 AND s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token), eventId]);
  return result.rowCount === 1;
}
function postgresCode(error: unknown) { return typeof error === "object" && error !== null && "code" in error ? error.code : undefined; }

const ACCOUNT_COLUMNS = "id, name, currency, opening_balance::text AS opening_balance, created_at";
type AccountRow = { id: string; name: string; currency: ReportingCurrency; opening_balance: string; created_at: Date };
function account(row: AccountRow): CashAccount {
  return { id: row.id, name: row.name, currency: row.currency, openingBalance: row.opening_balance, createdAt: row.created_at };
}

export async function listCashAccounts(token: string | undefined): Promise<CashAccount[]> {
  if (!token || !validToken(token)) return [];
  const result = await database().query<AccountRow>(`SELECT a.id, a.name, a.currency, a.opening_balance::text AS opening_balance, a.created_at
    FROM cash_accounts a JOIN workspaces w ON w.id = a.workspace_id JOIN sessions s ON s.user_id = w.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() ORDER BY a.name, a.id`, [tokenHash(token)]);
  return result.rows.map(account);
}

// null when the caller has no workspace yet.
export async function createCashAccount(token: string | undefined, input: unknown): Promise<CashAccount | null> {
  const data = cashAccountSchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  try {
    const result = await database().query<AccountRow>(`INSERT INTO cash_accounts(workspace_id, name, currency, opening_balance)
      SELECT w.id, $2, $3, $4 FROM sessions s JOIN workspaces w ON w.user_id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() RETURNING ${ACCOUNT_COLUMNS}`, [tokenHash(token), data.name, data.currency, data.openingBalance]);
    return result.rows[0] ? account(result.rows[0]) : await notFound(token);
  } catch (error) {
    if (postgresCode(error) === "23505") throw new DuplicateAccountNameError();
    throw error;
  }
}

// Only the name can change; currency and opening balance stay as created.
export async function renameCashAccount(token: string | undefined, accountId: unknown, input: unknown): Promise<CashAccount | null> {
  const name = accountNameSchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const id = uuidSchema.safeParse(accountId);
  if (!id.success) return notFound(token);
  try {
    const result = await database().query<AccountRow>(`UPDATE cash_accounts a SET name = $3, updated_at = now()
      FROM workspaces w, sessions s WHERE a.id = $2 AND w.id = a.workspace_id AND s.user_id = w.user_id
      AND s.token_hash = $1 AND s.expires_at > now()
      RETURNING a.id, a.name, a.currency, a.opening_balance::text AS opening_balance, a.created_at`, [tokenHash(token), id.data, name]);
    return result.rows[0] ? account(result.rows[0]) : await notFound(token);
  } catch (error) {
    if (postgresCode(error) === "23505") throw new DuplicateAccountNameError();
    throw error;
  }
}

type EventRow = {
  id: string; account_id: string; description: string; amount: string; currency: ReportingCurrency;
  expected_date: string; status: CashEventStatus; created_at: Date; updated_at: Date;
};
function event(row: EventRow): CashEvent {
  return {
    id: row.id, accountId: row.account_id, description: row.description, amount: row.amount, currency: row.currency,
    expectedDate: row.expected_date, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
// Writes return the changed row through this wrapper. Its currency comes from the account, and the date is
// formatted in SQL: the pg driver would turn a date into a local-time JavaScript Date and can shift the day.
const EVENT_OF_CHANGE = `SELECT c.id, c.account_id, c.description, c.amount::text AS amount, a.currency,
  to_char(c.expected_date, 'YYYY-MM-DD') AS expected_date, c.status, c.created_at, c.updated_at
  FROM changed c JOIN cash_accounts a ON a.id = c.account_id`;
const CHANGED_COLUMNS = "e.id, e.account_id, e.description, e.amount, e.expected_date, e.status, e.created_at, e.updated_at";

// Both dates are optional and inclusive. All statuses are returned; leaving out cancelled events is the forecast's job.
export async function listCashEvents(token: string | undefined, range: { from?: unknown; to?: unknown } = {}): Promise<CashEvent[]> {
  const from = range.from === undefined ? null : isoDateSchema.parse(range.from);
  const to = range.to === undefined ? null : isoDateSchema.parse(range.to);
  if (!token || !validToken(token)) return [];
  const result = await database().query<EventRow>(`SELECT e.id, e.account_id, e.description, e.amount::text AS amount, a.currency,
    to_char(e.expected_date, 'YYYY-MM-DD') AS expected_date, e.status, e.created_at, e.updated_at
    FROM cash_events e JOIN cash_accounts a ON a.id = e.account_id AND a.workspace_id = e.workspace_id
    JOIN workspaces w ON w.id = e.workspace_id JOIN sessions s ON s.user_id = w.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
    AND ($2::date IS NULL OR e.expected_date >= $2) AND ($3::date IS NULL OR e.expected_date <= $3)
    ORDER BY e.expected_date, e.id`, [tokenHash(token), from, to]);
  return result.rows.map(event);
}

// The account must belong to the caller's workspace, otherwise null. New events always start as "expected".
export async function createCashEvent(token: string | undefined, accountId: unknown, input: unknown): Promise<CashEvent | null> {
  const data = cashEventSchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const id = uuidSchema.safeParse(accountId);
  if (!id.success) return notFound(token);
  const result = await database().query<EventRow>(`WITH changed AS (
      INSERT INTO cash_events(workspace_id, account_id, description, amount, expected_date)
      SELECT w.id, a.id, $3, $4, $5 FROM sessions s JOIN workspaces w ON w.user_id = s.user_id
      JOIN cash_accounts a ON a.workspace_id = w.id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND a.id = $2
      RETURNING id, account_id, description, amount, expected_date, status, created_at, updated_at
    ) ${EVENT_OF_CHANGE}`, [tokenHash(token), id.data, data.description, data.amount, data.expectedDate]);
  return result.rows[0] ? event(result.rows[0]) : notFound(token);
}

// Description, amount and date only; the account and status do not change here. Only an "expected" event can be
// edited: settled events (received, paid, cancelled) feed the forecast's starting balance and never change.
// The status condition sits in the WHERE clause, so the check and the change are one atomic statement.
export async function updateCashEvent(token: string | undefined, eventId: unknown, input: unknown): Promise<CashEvent | null> {
  const data = cashEventSchema.parse(input);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const id = uuidSchema.safeParse(eventId);
  if (!id.success) return notFound(token);
  const result = await database().query<EventRow>(`WITH changed AS (
      UPDATE cash_events e SET description = $3, amount = $4, expected_date = $5, updated_at = now()
      FROM workspaces w, sessions s WHERE e.id = $2 AND w.id = e.workspace_id AND s.user_id = w.user_id
      AND s.token_hash = $1 AND s.expires_at > now() AND e.status = 'expected'
      RETURNING ${CHANGED_COLUMNS}
    ) ${EVENT_OF_CHANGE}`, [tokenHash(token), id.data, data.description, data.amount, data.expectedDate]);
  if (result.rows[0]) return event(result.rows[0]);
  if (await ownsEvent(token, id.data)) throw new StatusConflictError();
  return notFound(token);
}

// The only allowed transition is from "expected" to received, paid or cancelled; there is no undo.
// A settled event's date is the date the money moved: marking a future-dated event received or paid moves it
// to today (UTC, explicitly: current_date would depend on the session's time zone), in the same UPDATE. Past
// dates and cancelled events keep their date. This keeps the forecast's starting balance complete.
// Anything else (including setting "expected") raises StatusConflictError, as does a received expense or
// a paid income (the database sign rule). A foreign or unknown event is null, never a conflict.
export async function setCashEventStatus(token: string | undefined, eventId: unknown, status: unknown): Promise<CashEvent | null> {
  const next = eventStatusSchema.parse(status);
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const id = uuidSchema.safeParse(eventId);
  if (!id.success) return notFound(token);
  try {
    const result = await database().query<EventRow>(`WITH changed AS (
        UPDATE cash_events e SET status = $3, updated_at = now(),
          expected_date = CASE WHEN $3 IN ('received', 'paid') AND e.expected_date > (now() AT TIME ZONE 'UTC')::date
            THEN (now() AT TIME ZONE 'UTC')::date ELSE e.expected_date END
        FROM workspaces w, sessions s WHERE e.id = $2 AND w.id = e.workspace_id AND s.user_id = w.user_id
        AND s.token_hash = $1 AND s.expires_at > now() AND e.status = 'expected' AND $3 <> 'expected'
        RETURNING ${CHANGED_COLUMNS}
      ) ${EVENT_OF_CHANGE}`, [tokenHash(token), id.data, next]);
    if (result.rows[0]) return event(result.rows[0]);
  } catch (error) {
    if (postgresCode(error) === "23514") throw new StatusConflictError();
    throw error;
  }
  // Nothing changed: either the caller's event is not in the "expected" state, or it is not theirs.
  if (await ownsEvent(token, id.data)) throw new StatusConflictError();
  return notFound(token);
}

// Only an "expected" event can be deleted; a settled one throws StatusConflictError. Corrections to settled
// events are made with a new event.
export async function deleteCashEvent(token: string | undefined, eventId: unknown): Promise<boolean> {
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const id = uuidSchema.safeParse(eventId);
  if (!id.success) return (await notFound(token)) ?? false;
  const result = await database().query(`DELETE FROM cash_events e USING workspaces w, sessions s
    WHERE e.id = $2 AND w.id = e.workspace_id AND s.user_id = w.user_id AND s.token_hash = $1 AND s.expires_at > now()
    AND e.status = 'expected'`, [tokenHash(token), id.data]);
  if (result.rowCount === 1) return true;
  if (await ownsEvent(token, id.data)) throw new StatusConflictError();
  return (await notFound(token)) ?? false;
}
