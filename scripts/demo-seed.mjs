// Seeds a demo workspace for a person who has already registered through the application, so the presentation
// does not depend on typing events live and shows the same story every time.
//
//   npm run demo:seed -- --email demo@example.com            (DATABASE_URL from the environment or .env.local)
//   npm run demo:seed -- --email demo@example.com --dry-run  (prints the plan, writes nothing)
//
// Safety rules:
// - No account or password is created here. Register the demo user in the browser first; the password stays with
//   the person who chose it and nothing credential-related is in the repository.
// - It refuses a workspace that already has cash accounts, so it never mixes demo data with real data.
// - Everything is written in one transaction: either the whole demo exists or nothing changed.
// - No exchange rate is inserted. Rates come from the ECB through the application, as in normal use.
// - Dates are relative to today (UTC), so the demo always looks current.
import pg from "pg";
import { pathToFileURL } from "node:url";

const DAY = 86_400_000;
export function isoDay(today, offset) {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + offset * DAY).toISOString().slice(0, 10);
}

// The story: a German company with a euro operating account, US receivables and a small Singapore office.
// In the base case the euro account never falls below its danger threshold (50% of 20,000 = 10,000) in 90 days.
// If the customer invoice arrives three weeks late, payroll on day 10 takes it below the threshold.
export const DEMO_PLAN = Object.freeze({
  workspace: "Demo GmbH",
  accounts: [
    {
      key: "eur", name: "Operating account", currency: "EUR", openingBalance: "20000.00",
      events: [
        { key: "supplier", description: "Supplier invoice (overdue)", amount: "-1500.00", day: -4 },
        { key: "rent-1", description: "Office rent", amount: "-3000.00", day: 3 },
        { key: "invoice", description: "Customer invoice 2026-118", amount: "9000.00", day: 8 },
        { key: "payroll-1", description: "Payroll", amount: "-7000.00", day: 10 },
        { key: "retainer-1", description: "Customer retainer", amount: "8000.00", day: 30 },
        { key: "rent-2", description: "Office rent", amount: "-3000.00", day: 33 },
        { key: "payroll-2", description: "Payroll", amount: "-7000.00", day: 40 },
        { key: "retainer-2", description: "Customer retainer", amount: "8000.00", day: 60 },
        { key: "rent-3", description: "Office rent", amount: "-3000.00", day: 63 },
        { key: "payroll-3", description: "Payroll", amount: "-7000.00", day: 70 },
      ],
    },
    {
      key: "usd", name: "US receivables", currency: "USD", openingBalance: "4000.00",
      events: [
        { key: "hosting-1", description: "Cloud hosting", amount: "-450.00", day: 5 },
        { key: "us-client", description: "US client invoice", amount: "10000.00", day: 20 },
        { key: "hosting-2", description: "Cloud hosting", amount: "-450.00", day: 35 },
        { key: "hosting-3", description: "Cloud hosting", amount: "-450.00", day: 65 },
      ],
    },
    {
      key: "sgd", name: "Singapore office", currency: "SGD", openingBalance: "8000.00",
      events: [
        { key: "sg-rent", description: "Singapore office rent", amount: "-2600.00", day: 8 },
        { key: "sg-fee", description: "Consulting fee", amount: "5000.00", day: 25 },
      ],
    },
  ],
  scenarios: [
    { name: "Customer invoice three weeks late", delays: [{ event: "invoice", day: 29 }] },
    { name: "US client pays 30 days late", delays: [{ event: "us-client", day: 50 }] },
  ],
});

export async function seedDemo(client, { email, today = new Date() }) {
  if (typeof email !== "string" || !email.includes("@")) throw new Error("Pass the registered demo user's email address with --email.");
  const user = (await client.query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()])).rows[0];
  if (!user) throw new Error("No user with that email. Register the demo user in the application first.");

  await client.query("BEGIN");
  try {
    let workspace = (await client.query("SELECT id FROM workspaces WHERE user_id = $1 FOR UPDATE", [user.id])).rows[0];
    if (!workspace) {
      workspace = (await client.query("INSERT INTO workspaces (user_id, name) VALUES ($1, $2) RETURNING id", [user.id, DEMO_PLAN.workspace])).rows[0];
    }
    const existing = await client.query("SELECT count(*)::int AS n FROM cash_accounts WHERE workspace_id = $1", [workspace.id]);
    if (existing.rows[0].n > 0) {
      throw new Error("This workspace already has cash accounts. Use a fresh demo user so demo data never mixes with real data.");
    }

    const eventIds = new Map();
    for (const account of DEMO_PLAN.accounts) {
      const accountId = (await client.query(
        "INSERT INTO cash_accounts (workspace_id, name, currency, opening_balance) VALUES ($1, $2, $3, $4) RETURNING id",
        [workspace.id, account.name, account.currency, account.openingBalance],
      )).rows[0].id;
      for (const event of account.events) {
        const eventId = (await client.query(
          `INSERT INTO cash_events (workspace_id, account_id, description, amount, expected_date)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [workspace.id, accountId, event.description, event.amount, isoDay(today, event.day)],
        )).rows[0].id;
        eventIds.set(event.key, eventId);
      }
    }

    for (const scenario of DEMO_PLAN.scenarios) {
      const scenarioId = (await client.query(
        "INSERT INTO scenarios (workspace_id, name) VALUES ($1, $2) RETURNING id", [workspace.id, scenario.name],
      )).rows[0].id;
      for (const delay of scenario.delays) {
        await client.query(
          `INSERT INTO scenario_adjustments (workspace_id, scenario_id, cash_event_id, date_override)
           VALUES ($1, $2, $3, $4)`,
          [workspace.id, scenarioId, eventIds.get(delay.event), isoDay(today, delay.day)],
        );
      }
    }
    await client.query("COMMIT");
    return {
      workspaceId: workspace.id,
      accounts: DEMO_PLAN.accounts.length,
      events: DEMO_PLAN.accounts.reduce((sum, account) => sum + account.events.length, 0),
      scenarios: DEMO_PLAN.scenarios.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function describePlan(today) {
  const lines = [`Workspace: ${DEMO_PLAN.workspace} (kept if the user already has one)`];
  for (const account of DEMO_PLAN.accounts) {
    lines.push(`Account ${account.name} (${account.currency}), opening ${account.openingBalance}`);
    for (const event of account.events) lines.push(`  ${isoDay(today, event.day)}  ${event.amount.padStart(10)}  ${event.description}`);
  }
  for (const scenario of DEMO_PLAN.scenarios) lines.push(`Scenario: ${scenario.name}`);
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const email = args[args.indexOf("--email") + 1];
  if (!args.includes("--email") || !email) throw new Error("Usage: npm run demo:seed -- --email demo@example.com [--dry-run]");
  if (args.includes("--dry-run")) {
    console.log(describePlan(new Date()));
  } else {
    if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the database to seed.");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await seedDemo(client, { email });
      console.log(`Seeded ${result.accounts} accounts, ${result.events} events and ${result.scenarios} scenarios.`);
    } finally {
      await client.end();
    }
  }
}
