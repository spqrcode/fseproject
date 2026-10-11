# Testing and reproducibility

Use Node 24 and PostgreSQL 16. Start from `npm ci`, configure `.env.local`, and run `npm run verify`. That command includes a production build and the test migrations. `npx playwright install chromium` is needed once per machine; Linux may need `--with-deps`.

| Command | Coverage |
| --- | --- |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | Strict TypeScript |
| `npm test` | Credential/name validation, salts, password verification, corrupt hashes, tokens, money/percent/timestamp formatting, reporting currency, appearance validation, and Forecast Decimal/Money/FX rules |
| `npm exec vitest -- run tests/unit/forecast` | Decimal parsing, Money arithmetic, currency isolation, half-even rounding, immutability, and direct/reciprocal EUR/USD/SGD conversion |
| `npm run db:migrate:test` | Ordered migrations against the isolated test database |
| `npm run test:integration` | Real PostgreSQL sessions, ownership, constraints, rate limits, cash accounts and events (database constraints by direct SQL, two-user ownership matrix, forged and malformed ids, status transitions and the date a settled event gets, cascade, danger threshold), forecast input (starting balance on or before the start date, in `numeric`; overdue events; ranges of at most 366 dates; ownership), and server actions, including the reporting currency (two users, forged user id, anonymous/unknown/expired sessions, foreign origin, database constraint) active sessions (listing only the caller's unexpired sessions, signing out others without touching other users) and appearance (allowed values, ownership, origin, expiry, database constraint) |
| `npm run build` | Next.js production compilation and route generation |
| `npm run test:e2e` | Actual Chromium and production server: account lifecycle, cookies, expiry, workspace persistence; navigation of every section, removed routes, signed-out redirects, honest not-connected states, reporting currency persistence, expired session on an open settings page, skip link, no sideways scrolling at 375 px; public home page content, links, redirect of signed-in users and phone layout; signing out of other sessions across two browsers; dark and light appearance against a light or dark device, checked on the computed page background; axe-core WCAG 2.2 A/AA checks on every page, an error and a confirmation, in light and dark mode |

## Running the cash tests as the staging role

`tests/integration/cash-events.test.ts` and `tests/integration/forecast-input.test.ts` read an optional `TEST_FIXTURES_DATABASE_URL`. When it is set, the application under test connects as `DATABASE_URL` (a role with only the grants in [deployment](deployment.md)) while fixtures such as user creation, expiry changes and cleanup use the owner connection. Create a `_test` database, create the role `fse_runtime` first so the migrations' guarded grants apply, run the migrations as the owner, add the base grants listed in `deployment.md` for `users`, `sessions`, `auth_limits` and `workspaces`, then run `npx vitest run tests/integration/cash-events.test.ts tests/integration/forecast-input.test.ts` with those variables. The other integration files change state in ways the runtime role may not, so they run as the owner.

## Test isolation

`scripts/test.mjs` requires `TEST_DATABASE_URL` ending in `_test` and passes it as the child's `DATABASE_URL`. Playwright also checks they match. It starts a new server at `http://localhost:3100`, with `APP_ORIGIN` set to that address, and refuses to reuse another server. Tests cannot silently hit development/staging through the ordinary script commands.

Fixtures use unique generated account addresses, clean up only their own rows, and close database connections. No production table truncation, shared global counter, or hard-coded account credentials are needed. Retrying tests is not used to hide failures. Browser traces are disabled to avoid recording credentials; the HTML report retains names, outcomes, and sanitized assertion failures.

## Security evidence boundaries

Integration tests use the real PostgreSQL driver and SQL, including real password hashing. Only Next.js request adapters (cookies, headers, redirect, cache revalidation) are mocked so server actions can be invoked directly. Playwright verifies those adapters in a real application server. Neither layer substitutes mocked data for database authorization.

Cash-event projection, Scenario, provider-adapter, and broader financial/API tests do not exist because those features are not implemented. The Decimal/Money/FX foundation has focused unit tests. Staging smoke checks must be recorded separately from local tests. See [Issue 1 evidence](issue-1-evidence.md) for actual results and identified corrections.
