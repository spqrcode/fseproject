import { Pool } from "pg";

// Browser tests run a production server that converts any account outside the reporting currency with the rate
// service. Without a fresh cached snapshot it would call the real ECB endpoint, which makes the tests depend on the
// network. This seeds one fresh EUR/USD and EUR/SGD observation in the isolated _test database (realistic values,
// dated yesterday) so every conversion during the run comes from the cache; global-teardown.ts removes exactly
// these rows. The same values are exported so tests can compute expected amounts.
export const E2E_RATES = { USD: "1.0856", SGD: "1.4127" } as const;
export function e2eEffectiveDate() {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

export default async function globalSetup() {
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    const date = e2eEffectiveDate();
    for (const [quote, rate] of Object.entries(E2E_RATES)) {
      await db.query(
        `INSERT INTO fx_snapshots (provider, base_currency, quote_currency, rate, effective_date, fetched_at)
         VALUES ('ecb', 'EUR', $1, $2, $3, now())
         ON CONFLICT ON CONSTRAINT fx_snapshots_unique_rate DO UPDATE SET fetched_at = now()`,
        [quote, rate, date],
      );
    }
  } finally {
    await db.end();
  }
}
