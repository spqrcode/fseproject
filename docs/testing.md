# Testing and reproducibility

Use Node 24 and PostgreSQL 16. Start from `npm ci`, configure `.env.local`, and run `npm run verify`. That command includes a production build and the test migrations. `npx playwright install chromium` is needed once per machine; Linux may need `--with-deps`.

| Command | Coverage |
| --- | --- |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | Strict TypeScript |
| `npm test` | Credential/name validation, salts, password verification, corrupt hashes, tokens, money/percent/timestamp formatting, reporting currency, appearance validation, Forecast, delayed-invoice and percentage FX-shock domain rules, and ECB parser/provider/cache behavior |
| `npm exec vitest -- run tests/unit/forecast` | Decimal/Money/FX rules, adapter-facing cash-event validation, canonical timestamps, overdue events, bounded daily projection, status filtering, workspace/default thresholds, negative balances, minimum balance, runway, deterministic ordering and immutability |
| `npm run db:migrate:test` | Ordered migrations against the isolated test database |
| `npm run test:integration` | Real PostgreSQL sessions, ownership, constraints, rate limits, cash accounts and events (database constraints by direct SQL, two-user ownership matrix, forged and malformed ids, status transitions and the date a settled event gets, cascade, danger threshold), ECB snapshot constraints and atomic caching, delayed-invoice scenario ownership, isolation and adjustments that no longer apply, percentage FX-shock persistence and provenance, forecast input (starting balance on or before the start date, in `numeric`; overdue events; ranges of at most 366 dates; ownership), and server actions, including the reporting currency (two users, forged user id, anonymous/unknown/expired sessions, foreign origin, database constraint) active sessions (listing only the caller's unexpired sessions, signing out others without touching other users) and appearance (allowed values, ownership, origin, expiry, database constraint) |
| `npm run build` | Next.js production compilation and route generation |
| `npm run test:e2e` | Actual Chromium and production server: account lifecycle, cookies, expiry, workspace persistence; creating cash accounts, validating and preserving event input, creating and editing events, sign-aware received/paid actions, cancellation and overview counts; creating a scenario and delaying an invoice while leaving the original event unchanged; FX input validation; navigation, signed-out redirects, honest forecast states, reporting currency persistence, expired sessions, skip link and phone layout; sessions and appearance; axe-core WCAG 2.2 A/AA checks in light and dark mode |

## Running data-store tests as the staging role

CI runs these tests twice. `npm run test:integration` runs every integration file with the application connected as the database owner. `npm run test:integration:runtime` then runs the data-store files again with the application connected as the restricted staging role `fse_runtime`, so a missing grant fails CI with a "permission denied" error instead of being found on staging.

**Which files.** `scripts/test.mjs integration:runtime` runs every file in `tests/integration` that reads `TEST_FIXTURES_DATABASE_URL`: at the time of writing `cash-events`, `forecast-input`, `fx` and `liquidity-forecast`. Those files keep their fixtures (user creation, expiry changes, cleanup) on a separate owner connection, and the application under test uses `DATABASE_URL`, which the runtime mode points at `fse_runtime`. The other files (`ownership`, `preferences`, `sessions`, `cash-event-actions`, `scenario`, `fx-shock`) use one connection for application code and fixtures, and their guards require `DATABASE_URL` to equal `TEST_DATABASE_URL`. They need rights the staging role deliberately lacks: `DELETE` on `users`, `UPDATE` on `sessions` to expire a session, `DELETE` on `fx_snapshots`. They run as the owner only. A new data-store test that should also run as the role only has to read `TEST_FIXTURES_DATABASE_URL` the same way.

**How the role is built.** `scripts/ci-runtime-role.mjs` creates the role and applies the base grants of `deployment.md` (`users`, `sessions`, `auth_limits`, `workspaces`); the grants of migrations 003-008 come from the migrations themselves. The role must exist before the migrations, because their guarded `GRANT` blocks only run if it does, and the base grants can only be given after the migrations created the tables:

```sh
node --env-file-if-exists=.env.local scripts/ci-runtime-role.mjs role
npm run db:migrate:test
node --env-file-if-exists=.env.local scripts/ci-runtime-role.mjs base-grants
npm run test:integration:runtime
```

Both scripts need `TEST_DATABASE_URL` (the owner, a `_test` database) and `TEST_RUNTIME_DATABASE_URL` (user `fse_runtime`, a password of your choice, the same server and database) in `.env.local`. Use a fresh `_test` database: grants of earlier migrations are missing in a database that was migrated before the role existed. The role is created once per server and is visible to every database on it. `npm run verify` does not include the runtime step, so it still works without the role.

**What it finds.** A missing grant makes a store call fail with "permission denied". A grant that is too broad cannot make a store call fail, so `tests/integration/runtime-privileges.test.ts` checks it directly: it reads the privileges of `fse_runtime` from PostgreSQL (`has_table_privilege` and `has_column_privilege`, for every table and column of the schema, including `schema_migrations`, which must have none) and compares them for equality with an explicit map, so a missing and an extra privilege both fail. It also checks the role itself: login only, not superuser, no `CREATEDB`, `CREATEROLE`, `REPLICATION` or `BYPASSRLS`, no role memberships, owns no object, and no `CREATE` on schema `public` or on the database. A table that exists without an entry in the map fails too, so a new migration cannot add a table and forget its grants. The map is the executable form of the grant table in [deployment](deployment.md); change both, and the grants, together. The file runs only in the runtime step (`npm run test:integration:runtime`, where `TEST_FIXTURES_DATABASE_URL` is set); in the plain `npm run test:integration` it is skipped with the message "runs in test:integration:runtime", so it never depends on the state of a developer's database during `npm run verify`. In the runtime step a missing role is skipped locally with a message on stderr, but fails the file when the environment variable `CI` is set, so the check cannot disappear silently.

## Cash events product verification (2026-10-11)

`npm run verify` passed on the `feat/product-cash-events` branch (with `main` including #14 merged in) against PostgreSQL 16 in the isolated `portfolio_risk_test` database on 12 October 2026: ESLint with zero warnings, strict TypeScript, 293 unit tests, production build, migrations, 182 integration tests and 30 Chromium tests. The two new browser tests cover account creation, validation-error input preservation, signed expense and income display, event creation and editing, paid/received labels, cancellation, final-event immutability in the UI, and the overview event count. Existing axe-core checks also passed with the connected Cash events page in light and dark mode.

The Cash events page's server actions have their own integration file, `tests/integration/cash-event-actions.test.ts`: a foreign or missing origin saves nothing, anonymous and expired sessions are sent to sign in, another user's account or event is reported as unavailable and left unchanged, a forged status (paying an income, a status other than received, paid or cancelled) ends on "nothing was changed" rather than an error page, and settling a future-dated event moves its date to today with a message that says so.

## Scenario lab product verification (2026-10-12)

On the stacked `feat/product-scenario-lab` branch, lint, strict TypeScript, 277 unit tests, production build, migrations and 135 PostgreSQL integration tests passed against the isolated local `portfolio_risk_test` database. After correcting two browser assertions exposed by the first full run, `npm run test:e2e` passed all 27 Chromium tests. The new browser test creates a workspace, cash account, expected invoice and scenario; delays that invoice; checks the original and hypothetical dates side by side; verifies that the Cash events page still shows the original date; and checks invalid FX-pair feedback. It does not make a live ECB request. Deployment and a numerical forecast comparison were not tested here.

Review follow-up on the same branch (2026-10-12): a saved shock now carries a read-only hint when a newer snapshot for its ECB pair is already cached. A fresh `portfolio_risk_hint_test` database was created with migrations 001–008 so migration 009 from a different local branch could not affect these tests. Lint, typecheck, 298 unit tests, production build, 184 PostgreSQL integration tests and 33 Chromium tests passed. The integration test covers an unchanged observation, another pair, a later effective date and a correction to the same effective date; the browser test confirms the saved rate/date do not change when the hint appears. No ECB network request or Vercel deployment was part of this verification.

The Scenario lab's server actions are covered the same way in `tests/integration/scenario-actions.test.ts`: a scenario, a delay and a saved shock for the signed-in user; validation; another user's scenario or invoice refused with nothing changed; a missing or foreign origin saving nothing; anonymous and expired sessions sent to sign in.

`tests/integration/demo-seed.test.ts` runs the demo seed against PostgreSQL and reads it back through the real stores and the engine: it checks what is written, that the base forecast of the euro account stays above its threshold while the late-invoice scenario falls below it on payroll day, and that a workspace with existing accounts or an unknown user is refused with nothing written.

## Test isolation

`scripts/test.mjs` requires `TEST_DATABASE_URL` ending in `_test` and passes it as the child's `DATABASE_URL`. Playwright also checks they match. It starts a new server at `http://localhost:3100`, with `APP_ORIGIN` set to that address, and refuses to reuse another server. Tests cannot silently hit development/staging through the ordinary script commands.

Fixtures use unique generated account addresses, clean up only their own rows, and close database connections. No production table truncation, shared global counter, or hard-coded account credentials are needed. Retrying tests is not used to hide failures. Browser traces are disabled to avoid recording credentials; the HTML report retains names, outcomes, and sanitized assertion failures.

## Security evidence boundaries

Integration tests use the real PostgreSQL driver and SQL, including real password hashing. Only Next.js request adapters (cookies, headers, redirect, cache revalidation) are mocked so server actions can be invoked directly. Playwright verifies those adapters in a real application server. Neither layer substitutes mocked data for database authorization.

Cash-event persistence and its browser user flow, delayed-invoice scenarios, Scenario lab invoice-delay UI and percentage FX-shock persistence are covered by automated tests. A live ECB preview, the numerical Forecast-to-FX adapter and broader financial/API integration tests remain separate work. The Forecast domain has focused Decimal/Money/FX, CashEvent, projection and delayed-invoice unit tests; the ECB provider/cache has focused unit and PostgreSQL integration tests. Automated FX tests use injected provider responses; a live call to the public ECB endpoint is a separate smoke check and is not required for deterministic CI. Staging smoke checks must be recorded separately from local tests. See [Issue 1 evidence](issue-1-evidence.md) for actual results and identified corrections.
