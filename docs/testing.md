# Testing and reproducibility

Use Node 24 and PostgreSQL 16. Start from `npm ci`, configure `.env.local`, and run `npm run verify`. That command includes a production build and the test migrations. `npx playwright install chromium` is needed once per machine; Linux may need `--with-deps`.

| Command | Coverage |
| --- | --- |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | Strict TypeScript |
| `npm test` | Credential/name validation, salts, password verification, corrupt hashes, tokens, money/percent/timestamp formatting, reporting currency, appearance validation, Forecast Decimal/Money/FX rules, ECB parser/provider/cache behavior, immutable delayed-invoice scenarios, and percentage-based FX shock results |
| `npm exec vitest -- run tests/unit/forecast` | Decimal parsing, Money arithmetic, currency isolation, half-even rounding, immutability, direct/reciprocal EUR/USD/SGD conversion, delayed dates and base/scenario deltas |
| `npm run db:migrate:test` | Ordered migrations against the isolated test database |
| `npm run test:integration` | Real PostgreSQL sessions, ownership, constraints, rate limits, cash accounts and events, ECB snapshot constraints and atomic caching, delayed-invoice scenarios, percentage FX shocks (constraints, provenance, invalidation, malformed IDs and cross-workspace isolation), and server actions including reporting currency, active sessions and appearance |
| `npm run build` | Next.js production compilation and route generation |
| `npm run test:e2e` | Actual Chromium and production server: account lifecycle, cookies, expiry, workspace persistence; navigation of every section, removed routes, signed-out redirects, honest not-connected states, reporting currency persistence, expired session on an open settings page, skip link, no sideways scrolling at 375 px; public home page content, links, redirect of signed-in users and phone layout; signing out of other sessions across two browsers; dark and light appearance against a light or dark device, checked on the computed page background; axe-core WCAG 2.2 A/AA checks on every page, an error and a confirmation, in light and dark mode |

## Running data-store tests as the staging role

`tests/integration/cash-events.test.ts` and `tests/integration/fx.test.ts` read an optional `TEST_FIXTURES_DATABASE_URL`. When it is set, the application under test connects as `DATABASE_URL` (a role with only the grants in [deployment](deployment.md)) while fixtures and cleanup use a separate owner connection. Create a `_test` database, create `fse_runtime` first so the migrations' guarded grants apply, run migrations as the owner, and supply the owner URL as `TEST_FIXTURES_DATABASE_URL`. Cash-event tests additionally need the base grants listed in `deployment.md`. The FX test verifies that migration 006 permits cache reads/inserts and only fetch-time updates while refusing DELETE and immutable-column updates, including changes to an existing snapshot rate.

## Test isolation

`scripts/test.mjs` requires `TEST_DATABASE_URL` ending in `_test` and passes it as the child's `DATABASE_URL`. Playwright also checks they match. It starts a new server at `http://localhost:3100`, with `APP_ORIGIN` set to that address, and refuses to reuse another server. Tests cannot silently hit development/staging through the ordinary script commands.

Fixtures use unique generated account addresses, clean up only their own rows, and close database connections. No production table truncation, shared global counter, or hard-coded account credentials are needed. Retrying tests is not used to hide failures. Browser traces are disabled to avoid recording credentials; the HTML report retains names, outcomes, and sanitized assertion failures.

## Security evidence boundaries

Integration tests use the real PostgreSQL driver and SQL, including real password hashing. Only Next.js request adapters (cookies, headers, redirect, cache revalidation) are mocked so server actions can be invoked directly. Playwright verifies those adapters in a real application server. Neither layer substitutes mocked data for database authorization.

The Decimal/Money/FX foundation, ECB provider/cache, delayed-invoice scenarios and percentage shocks have focused tests. The final Forecast Engine adapter and Scenario UI remain pending and are not claimed by these tests. Automated FX tests use injected provider responses; a live call to the public ECB endpoint is a separate smoke check and is not required for deterministic CI. Staging smoke checks must be recorded separately from local tests. See [Issue 1 evidence](issue-1-evidence.md) for actual results and identified corrections.
