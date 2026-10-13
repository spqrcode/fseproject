import { Pool } from "pg";
import { E2E_RATES, e2eEffectiveDate } from "./global-setup";

// Removes only the snapshots global-setup.ts inserted.
export default async function globalTeardown() {
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    for (const [quote, rate] of Object.entries(E2E_RATES)) {
      await db.query(
        "DELETE FROM fx_snapshots WHERE provider = 'ecb' AND base_currency = 'EUR' AND quote_currency = $1 AND rate = $2 AND effective_date = $3",
        [quote, rate, e2eEffectiveDate()],
      );
    }
  } finally {
    await db.end();
  }
}
