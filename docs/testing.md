# Testing and reproducibility

Use Node 24 and PostgreSQL 16. Start from `npm ci`, configure `.env.local`, and run `npm run verify`. That command includes a production build and the test migrations. `npx playwright install chromium` is needed once per machine; Linux may need `--with-deps`.

| Command | Coverage |
| --- | --- |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | Strict TypeScript |
| `npm test` | Credential/name validation, salts, password verification, corrupt hashes, tokens, holding ticker and amount rules |
| `npm run db:migrate:test` | Ordered migrations against the isolated test database |
| `npm run test:integration` | Real PostgreSQL sessions, portfolio and holdings ownership, constraints, rate limits, and server actions |
| `npm run build` | Next.js production compilation and route generation |
| `npm run test:e2e` | Actual Chromium and production server: account lifecycle, cookies, expiry, portfolio persistence, holdings CRUD and cross-user isolation |

## Test isolation

`scripts/test.mjs` requires `TEST_DATABASE_URL` ending in `_test` and passes it as the child's `DATABASE_URL`. Playwright also checks they match. It starts a new server at `http://localhost:3100`, with `APP_ORIGIN` set to that address, and refuses to reuse another server. Tests cannot silently hit development/staging through the ordinary script commands.

Fixtures use unique generated account addresses, clean up only their own rows, and close database connections. No production table truncation, shared global counter, or hard-coded account credentials are needed. Retrying tests is not used to hide failures. Browser traces are disabled to avoid recording credentials; the HTML report retains names, outcomes, and sanitized assertion failures.

## Security evidence boundaries

Integration tests use the real PostgreSQL driver and SQL, including real password hashing. Only Next.js request adapters (cookies, headers, redirect, cache revalidation) are mocked so server actions can be invoked directly. Playwright verifies those adapters in a real application server. Neither layer substitutes mocked data for database authorization.

Quote and valuation tests do not exist because those features are not implemented. Staging smoke checks must be recorded separately from local tests. See [Issue 1 evidence](issue-1-evidence.md) for actual results and identified corrections.

## Holdings coverage added in Issue 2

Unit tests cover the input rules alone: ticker normalization and rejection, and amounts given as `NaN`, `Infinity`, `-Infinity`, `1e5`, signed values, `0`, `0.0`, over-precision, over-length, a thousands separator, and the largest value the column accepts. Amounts stay strings through validation, so no precision is lost before the later valuation work.

Integration tests run against real PostgreSQL and cover the full round trip, duplicate tickers (including a case-variant duplicate, and the same ticker allowed in a different user's portfolio), the constraints themselves through direct SQL that bypasses the form, cascade deletion with the account, and the whole ownership matrix: another user's list, anonymous and unknown tokens, another user's holding id, an unknown id, a non-UUID id, a submitted `portfolio_id`, an attempted move into another portfolio, an expired session, and a missing or foreign request origin. Two of these assert that the response for another user's id is byte-identical to the response for an id that never existed, so the form cannot be used to discover which identifiers exist.

Browser tests repeat the important paths through the real server: add, reload, edit, reload, remove; a duplicate and four invalid amounts leaving stored data unchanged; a second browser context that can neither see the first user's holding nor change it by submitting its id; and an expired session failing to delete a holding from a page that is already open.

One deliberate UI decision shows up in the tests: a successful removal is confirmed by the row disappearing, because the row carries its own notice and unmounts with it. A failed removal keeps the row and shows the error there.
