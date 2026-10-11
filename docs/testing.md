# Testing and reproducibility

Use Node 24 and PostgreSQL 16. Start from `npm ci`, configure `.env.local`, and run `npm run verify`. That command includes a production build and the test migrations. `npx playwright install chromium` is needed once per machine; Linux may need `--with-deps`.

| Command | Coverage |
| --- | --- |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | Strict TypeScript |
| `npm test` | Credential/name validation, salts, password verification, corrupt hashes, tokens, money/percent/timestamp formatting, reporting currency, appearance validation, Forecast domain rules, and ECB parser/provider/cache behavior |
| `npm exec vitest -- run tests/unit/forecast` | Decimal/Money/FX rules, adapter-facing cash-event validation, canonical timestamps, overdue events, bounded daily projection, status filtering, workspace/default thresholds, negative balances, minimum balance, runway, deterministic ordering and immutability |
| `npm run db:migrate:test` | Ordered migrations against the isolated test database |
| `npm run test:integration` | Real PostgreSQL sessions, ownership, constraints, rate limits, cash accounts/events, ECB snapshot constraints and atomic caching, and server actions including reporting currency, active sessions and appearance |
| `npm run build` | Next.js production compilation and route generation |
| `npm run test:e2e` | Actual Chromium and production server: account lifecycle, cookies, expiry, workspace persistence; creating cash accounts, validating and preserving event input, creating and editing events, sign-aware received/paid actions, cancellation and overview counts; navigation of every section, removed routes, signed-out redirects, honest forecast/scenario states, reporting currency persistence, expired sessions, skip link and phone layout; sessions and appearance; axe-core WCAG 2.2 A/AA checks in light and dark mode |

## Running data-store tests as the staging role

`tests/integration/cash-events.test.ts` and `tests/integration/fx.test.ts` read an optional `TEST_FIXTURES_DATABASE_URL`. When it is set, the application under test connects as `DATABASE_URL` (a role with only the grants in [deployment](deployment.md)) while fixtures and cleanup use a separate owner connection. Create a `_test` database, create `fse_runtime` first so the migrations' guarded grants apply, run migrations as the owner, and supply the owner URL as `TEST_FIXTURES_DATABASE_URL`. Cash-event tests additionally need the base grants listed in `deployment.md`. The FX test verifies that migration 006 permits cache reads/inserts and only fetch-time updates while refusing DELETE and immutable-column updates, including changes to an existing snapshot rate.

## Cash events product verification (2026-10-11)

`npm run verify` passed on the `feat/product-cash-events` branch against PostgreSQL 16 in the isolated `portfolio_risk_test` database: ESLint with zero warnings, strict TypeScript, 120 unit tests, production build, migrations, 99 integration tests and 26 Chromium tests. The two new browser tests cover account creation, validation-error input preservation, signed expense and income display, event creation and editing, paid/received labels, cancellation, final-event immutability in the UI, and the overview event count. Existing axe-core checks also passed with the connected Cash events page in light and dark mode.

## Test isolation

`scripts/test.mjs` requires `TEST_DATABASE_URL` ending in `_test` and passes it as the child's `DATABASE_URL`. Playwright also checks they match. It starts a new server at `http://localhost:3100`, with `APP_ORIGIN` set to that address, and refuses to reuse another server. Tests cannot silently hit development/staging through the ordinary script commands.

Fixtures use unique generated account addresses, clean up only their own rows, and close database connections. No production table truncation, shared global counter, or hard-coded account credentials are needed. Retrying tests is not used to hide failures. Browser traces are disabled to avoid recording credentials; the HTML report retains names, outcomes, and sanitized assertion failures.

## Security evidence boundaries

Integration tests use the real PostgreSQL driver and SQL, including real password hashing. Only Next.js request adapters (cookies, headers, redirect, cache revalidation) are mocked so server actions can be invoked directly. Playwright verifies those adapters in a real application server. Neither layer substitutes mocked data for database authorization.

Cash-event persistence and its browser user flow are covered. Scenario persistence and UI, the Forecast-to-FX adapter, and broader financial/API integration tests remain separate work. The Forecast domain has focused Decimal/Money/FX, CashEvent and projection unit tests; the ECB provider/cache has focused unit and PostgreSQL integration tests. Automated FX tests use injected provider responses; a live call to the public ECB endpoint is a separate smoke check and is not required for deterministic CI. Staging smoke checks must be recorded separately from local tests. See [Issue 1 evidence](issue-1-evidence.md) for actual results and identified corrections.
