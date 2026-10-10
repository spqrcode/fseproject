import "server-only";
import { database } from "@/lib/db";
import { notFound } from "@/lib/cash-events-store";
import { type ReportingCurrency } from "@/lib/currency";
import { tokenHash, validToken } from "@/lib/session-store";
import { forecastRangeSchema, uuidSchema } from "@/lib/validation";

export type ForecastEventInput = {
  id: string; description: string; amount: string;
  expectedDate: string;  // the date the forecast uses: overdue events are moved to startDate
  originalDate: string;  // the stored date
  overdue: boolean;      // originalDate is before startDate
  createdAt: string;     // UTC, ends in Z
};
export type ForecastInput = {
  account: { id: string; name: string; currency: ReportingCurrency };
  startDate: string; endDate: string;
  startingBalance: string;
  dangerThreshold: string | null;  // the workspace value; null means the engine's default
  events: ForecastEventInput[];
};

type AccountRow = { id: string; name: string; currency: ReportingCurrency; danger_threshold: string | null; starting_balance: string };
type EventRow = { id: string; description: string; amount: string; expected_date: string; original_date: string; overdue: boolean; created_at: string };

// Everything the engine needs for one account, resolved by the team's rules (decisions of 2026-10-08):
// - startingBalance = opening balance + the account's received and paid events dated before startDate;
// - events = the account's expected events up to endDate, overdue ones counted on startDate;
// - cancelled events appear nowhere.
// Both queries start at the session token and reach the account through sessions -> workspaces -> cash_accounts.
// The ids of the workspace and the user are never taken from input. A foreign, unknown or malformed account id
// gives null; no valid session throws. The range is validated first, so an invalid range is a validation error.
export async function getForecastInput(token: string | undefined, input: { accountId: unknown; startDate: unknown; endDate: unknown }): Promise<ForecastInput | null> {
  const range = forecastRangeSchema.parse({ startDate: input.startDate, endDate: input.endDate });
  if (!token || !validToken(token)) throw new Error("Authentication required.");
  const accountId = uuidSchema.safeParse(input.accountId);
  if (!accountId.success) return notFound(token);

  // One read-only transaction with a repeatable-read snapshot: both queries see the same data, so an event
  // that changes status in between cannot fall out of both the balance and the list.
  const client = await database().connect();
  let failure = false;
  let found: ForecastInput | null = null;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // The sum is computed by PostgreSQL in numeric, never with JavaScript numbers.
    const account = await client.query<AccountRow>(`SELECT a.id, a.name, a.currency, w.danger_threshold::text AS danger_threshold,
        (a.opening_balance + COALESCE((SELECT sum(e.amount) FROM cash_events e WHERE e.account_id = a.id AND e.workspace_id = a.workspace_id
          AND e.status IN ('received', 'paid') AND e.expected_date < $3::date), 0))::text AS starting_balance
      FROM cash_accounts a JOIN workspaces w ON w.id = a.workspace_id JOIN sessions s ON s.user_id = w.user_id
      WHERE a.id = $2 AND s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token), accountId.data, range.startDate]);
    if (account.rows[0]) {
      const events = await client.query<EventRow>(`SELECT e.id, e.description, e.amount::text AS amount,
          to_char(GREATEST(e.expected_date, $3::date), 'YYYY-MM-DD') AS expected_date,
          to_char(e.expected_date, 'YYYY-MM-DD') AS original_date,
          e.expected_date < $3::date AS overdue,
          to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
        FROM cash_events e JOIN cash_accounts a ON a.id = e.account_id AND a.workspace_id = e.workspace_id
        JOIN workspaces w ON w.id = a.workspace_id JOIN sessions s ON s.user_id = w.user_id
        WHERE a.id = $2 AND s.token_hash = $1 AND s.expires_at > now() AND e.status = 'expected' AND e.expected_date <= $4::date
        ORDER BY GREATEST(e.expected_date, $3::date), e.created_at, e.id`, [tokenHash(token), accountId.data, range.startDate, range.endDate]);
      const row = account.rows[0];
      found = {
        account: { id: row.id, name: row.name, currency: row.currency },
        startDate: range.startDate, endDate: range.endDate,
        startingBalance: row.starting_balance, dangerThreshold: row.danger_threshold,
        events: events.rows.map(e => ({ id: e.id, description: e.description, amount: e.amount, expectedDate: e.expected_date,
          originalDate: e.original_date, overdue: e.overdue, createdAt: e.created_at })),
      };
    }
    await client.query("COMMIT");
  } catch (error) {
    failure = true;
    throw error;
  } finally {
    client.release(failure);  // true discards a connection that failed mid-transaction
  }
  return found ?? notFound(token);
}
