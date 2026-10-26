# Requirements

Status: the stories below are implemented as the traceability table at the end of this document states; stories that belonged to the earlier portfolio dashboard are recorded under "Earlier scope (replaced)".

## US-01 — Account and session

As a visitor, I can register, log in, and log out so that I can securely access my data.

Acceptance criteria:
- Valid registration stores a password hash and returns a generic response; duplicate registration does not overwrite credentials. Email verification is out of scope for this increment. Invalid input is rejected server-side.
- Valid credentials establish a session; invalid credentials do not disclose whether an account exists.
- Protected pages and server operations reject unauthenticated or expired sessions.
- Logout removes the current session and protected navigation requires login again.

## US-02 — Workspace

As a signed-in user, I can create, view and rename my own workspace, the container for my cash accounts, cash events and scenarios.

Acceptance criteria:
- A user has at most one workspace; the database enforces this with a unique owner column.
- A valid name (trimmed, 1 to 80 characters) is persisted and survives reload. Creating and renaming use the same form.
- Empty and invalid names are rejected server-side, and the database checks the same rule.
- Changing the workspace requires a valid session and a request from the application's own origin.
- Other users cannot read or change the workspace, including through direct requests to the server action.

## Earlier scope (replaced)

US-03 (Holdings), US-04 (Quotes), US-05 (Valuation) and US-06 (Allocation and P/L contribution) described the portfolio dashboard that FinTwin Global replaced after the group consultation. They were removed as stories, no holdings, quotes or valuations exist in the code, and the numbers US-03 to US-06 are not reused.

## US-07 — Ownership isolation

As a user, my workspace and everything stored in it (cash accounts, cash events, scenarios, delayed-invoice adjustments and FX shocks) are accessible only to me.

Acceptance criteria:
- Server-side data access starts at an unexpired session and reaches rows through the session's user and workspace; no user, workspace or ownership id is taken from input, and unknown keys such as a submitted `workspaceId` are ignored. The database is not exposed to browser clients.
- Another user's id and a non-existent id give the same result, and a malformed id is treated like a missing one, without a distinguishable database error.
- Anonymous, unknown and expired sessions can neither read nor change data.
- PostgreSQL refuses cross-workspace references even if the application check is bypassed: composite foreign keys tie an event to an account of its own workspace, and an adjustment or FX shock to a scenario of its own workspace, and an adjustment to an event of its own workspace.
- Deleting a user removes their workspace, accounts, events, scenarios and adjustments.
- Automated tests use two users and unauthenticated or expired clients to attempt unauthorized operations on each of these data sets; the cash-event and forecast-input tests can also be run with the application connected as the restricted staging role (see [testing](testing.md)).

## US-08 Reporting currency and navigation (FinTwin Global)

As a signed-in user, I can move between the FinTwin Global sections and choose the currency in which my figures are reported. Acceptance criteria and implementation are in [product experience](product-experience.md#us-08-reporting-currency).

Supported reporting currencies: EUR, USD and SGD, agreed at the team meeting on 2 October 2026. SGD is kept for the APAC use case in the proposal and is dropped only if its exchange rates cause problems. All three are published as ECB euro reference rates, so the FX source can supply EUR/USD and EUR/SGD directly and USD/SGD in both directions through the euro. The Forecast Engine and Scenarios & FX build against this list. To change it, edit this line, `REPORTING_CURRENCIES` in `src/lib/currency.ts` and the forecast currency list; no migration is needed, because the database only checks the three-letter shape.

## US-11 Cash accounts and cash events (data layer)

As a signed-in user, I have a workspace with cash accounts in EUR, USD or SGD and cash events (expected income and expenses) on them. Acceptance criteria for the data layer, which the Cash events page uses:
- Amounts are signed decimal strings with at most 2 decimals: income above zero, expense below zero, zero invalid; NaN, exponents and extra decimals are rejected.
- An event's date is a date without time. Statuses are expected, received, paid and cancelled; received applies only to income and paid only to expenses; cancelled events are left out of forecasts.
- An event's currency is its account's currency; an event can never belong to another workspace's account.
- Only the owner can list, create, change or delete accounts and events; another user's id and a non-existent id give the same result.
- A status moves only from expected to received, paid or cancelled.
- Received, paid and cancelled events cannot be edited or deleted; corrections are made with a new event.
- A workspace can store an optional danger threshold.
- A settled event's date is the date the money moved: marking a future-dated event received or paid moves it to today (UTC).
- A new event can repeat monthly, quarterly or annually, ending after 2 to 60 occurrences or on an end date (inclusive): one ordinary expected event per occurrence on the same day of the month, moved to the month's last day when that day does not exist. All occurrences are saved together or not at all, and only on the caller's own account. Open-ended repeats are out of scope (final-submission scope, 2026-10-26).

## US-12 Delayed-invoice scenarios

As a signed-in user, I can delay an expected customer invoice in a scenario so that I can compare the liquidity impact without changing the real cash event or base forecast.

- A delay applies only to an expected positive cash event and uses a strictly later valid date.
- The scenario and target event must belong to the same workspace; PostgreSQL enforces this with composite foreign keys.
- The persisted cash event, its original date and the base forecast remain unchanged.
- Two scenarios can delay the same event independently.
- Missing, inaccessible, malformed and ineligible targets fail explicitly without revealing another workspace's data.
- Deleting an expected event removes its dependent hypothetical adjustment, and deleting the user cascades all scenario data.

## US-13 Reliable ECB exchange rates

As a signed-in user, I can use EUR, USD and SGD exchange rates with visible source, effective date and freshness so that a forecast never silently uses a fabricated or mismatched rate.

- The server fetches the latest EUR/USD and EUR/SGD observations from the official ECB SDMX endpoint; USD/SGD and reciprocal pairs are derived with Decimal arithmetic.
- Only validated positive plain-decimal rates and real date-only effective dates are stored. Values that would be rounded by `numeric(30,15)` are rejected before persistence.
- A snapshot fetched within one hour is CURRENT and avoids a provider call. After a refresh failure, an older snapshot may be returned only as STALE with its effective date and failure metadata.
- With no usable snapshot, the result is UNAVAILABLE with a null rate and an explicit failure code; zero and hard-coded fallback numbers are forbidden. Failure messages exposed to the UI are fixed safe text rather than raw network, proxy or database details.
- Existing snapshot ids are immutable. A corrected ECB rate for the same effective date receives a new id, while an identical repeat updates only its fetch time.
- A cross-rate uses two ECB legs from the same effective date. Different dates return UNAVAILABLE instead of a mixed-date number.
- Results include provider, source snapshot IDs, effective date and fetch timestamp for the Scenario Lab.

## US-14 Percentage-based FX shocks

As a signed-in user, I can apply a percentage shock to a resolved EUR, USD or SGD rate and see the hypothetical rate without changing the stored ECB observation.

- `-10` means minus 10%, not a ratio of `-0.1`; percentages must be plain decimals from -99.99 to 100 with at most four decimals, for the preview and for saving alike.
- The FX service resolves direct, reciprocal and cross rates before the Forecast Engine consumes them. The engine does not derive SGD/EUR or USD/SGD itself.
- Calculations use Decimal arithmetic with no implicit display rounding and leave snapshots unchanged.
- CURRENT and STALE results include source and adjusted decimal strings, requested pair, effective date, provider and source snapshot IDs.
- UNAVAILABLE returns null source and adjusted rates with an explicit failure; it never fabricates a fallback number.
- Persisted shocks are workspace-isolated and keep their immutable snapshot provenance.

## Engineering acceptance criteria

- Authentication plus three distinct product views: Cash events, Liquidity overview and Scenario lab (with the Workspace and Settings pages around them).
- A persistent database, secure authentication, authorization, and meaningful external API integration are demonstrated.
- Pull requests run automated tests, lint, TypeScript checks, and a production build.
- GitHub history includes genuine contributions and reviews from all four students.
- The application is publicly reachable for assessment; private data still requires authentication.
- Requirements, architecture, decisions, tests, security, deployment, limitations, and AI use are documented.
- AI-generated changes receive the same review and verification as human-authored changes.

## Traceability

| Requirement | Implementation | Verification | Delivery |
| --- | --- | --- | --- |
| US-01 registration, login, logout | `src/app/actions/auth.ts`, password/session modules | Unit security tests; integration server-action tests; all four E2E scenarios | `feat/auth-foundation`; staging record in deployment document |
| US-01 session expiration/revocation | Session SQL and protected page/action checks | Integration expiry/replay; browser expiry, logout replay, expired open form | Same branch and deployment |
| US-07 ownership isolation | `src/lib/workspace-store.ts`, `src/lib/cash-events-store.ts`, `src/lib/forecast-input-store.ts`, `src/lib/scenario-store.ts`, `src/lib/fx/shock-store.ts`, `requireUser`, composite foreign keys in migrations 005, 007 and 008 | Real-database two-user, anonymous, expired, forged-owner and malformed-id tests in `ownership`, `cash-events`, `cash-event-actions`, `forecast-input`, `liquidity-forecast`, `scenario` and `fx-shock`; cross-workspace insert refused by the database with application checks bypassed; the cash-event and forecast tests were also run as the staging role | Foundation & Security branches, extended by each feature branch |
| Reproducible automated checks | `scripts/test.mjs`, `.github/workflows/ci.yml` | Migration rerun; full `npm run verify` | GitHub PR CI |
| US-08 reporting currency | `src/lib/preferences-store.ts`, `src/app/actions/preferences.ts`, migration 003 | Unit currency validation; integration ownership, origin, expiry and constraint tests; Playwright persistence and expired-session tests | Product experience branch |
| US-08 public home page | `src/app/page.tsx` | Playwright content, links, signed-in redirect and phone-width tests | Product experience branch |
| US-10 appearance | Migration 004, `src/lib/preferences-store.ts`, `updateAppearance`, `src/components/appearance-form.tsx`, dark palette | Unit choice validation; integration ownership, origin, expiry and constraint tests; Playwright device-following, saved dark and light overrides and persistence | Product experience branch |
| US-09 active sessions | `src/lib/account-sessions.ts`, `src/app/actions/account.ts`, settings page | Integration own-sessions listing, other-user isolation, expired caller, origin and redirect tests; Playwright two-browser sign-out test | Product experience branch |
| US-08 navigation and states | `src/components/navigation.tsx`, `(protected)` loading, error, forecast, scenarios and settings pages | Playwright navigation, signed-out redirects, keyboard and phone-width tests | Product experience branch |
| US-11 cash accounts and events | Migration 005, `src/lib/cash-events-store.ts`, `src/lib/workspace-store.ts`, cash schemas in `src/lib/validation.ts` | Integration constraints by direct SQL, two-user ownership matrix, anonymous/unknown/expired sessions, malformed ids, status transitions, cascade, and a run as the staging role; unit amount and date validation | Foundation & Security branch; the Cash events page (`/cash-events`) is built on it |
| US-11 repeating events | `src/lib/recurring-dates.ts`, `repeatFrequencySchema`, `repeatEndSchema` and `repeatDatesSchema` in `src/lib/validation.ts`, `createCashEvents` in `src/lib/cash-events-store.ts` (one `INSERT` over `unnest`), `addCashEvent`, the Repeat and Ends fields in `src/components/cash-event-form.tsx` | Unit: monthly, quarterly and annual dates, month ends and 29 February, year change, end date inclusive, the 60-occurrence limit, accepted and rejected frequencies and ends; integration: one row per date in order, per-occurrence status, another user's or a missing account saves nothing, invalid input, anonymous and unknown sessions, and the server action's messages for every refused input | Foundation & Security branch `feat/monthly-recurring-events` |
| US-11 settled events immutable | `updateCashEvent` and `deleteCashEvent` in `src/lib/cash-events-store.ts` (status condition in the `WHERE` clause) | Integration: editing and deleting received, paid and cancelled events refused with the row unchanged; expected events still work; another user's settled event gives the same null as a missing one | Foundation & Security branch (review feedback on PR #10) |
| US-11 forecast input (decisions of 2026-10-08, implemented 2026-10-10) | `src/lib/forecast-input-store.ts` (starting balance, overdue events, threshold), `toForecastInput` in `src/lib/forecast/input-adapter.ts` (status mapping), date rule in `setCashEventStatus`; see [decisions](decisions.md#2026-10-10--forecast-input-implemented-a-settled-events-date-is-the-date-the-money-moved) | Integration: starting balance with events before, on and after the start date (on or before counts), cancelled and other accounts and users ignored, early-settled event in the balance, overdue events, ranges, ownership matrix; unit: range and the adapter (`input-adapter.test.ts`); also run as the staging role | Foundation & Security branch `feat/forecast-input`. The Liquidity overview (`src/lib/liquidity-forecast.ts`) calls the store, `toForecastInput` and the engine |
| US-12 delayed-invoice scenarios | Migration 007, `src/lib/scenario-store.ts`, immutable scenario projection in `src/lib/forecast/scenario.ts` | Unit immutability and delta tests; PostgreSQL ownership, composite-FK, eligibility, date-only, cascade and base-forecast isolation tests | PR #9; aligned to the merged PR #12 engine; adjustments that cannot apply are skipped and reported (decision of 2026-10-12) |
| US-12 base versus scenario comparison | `src/lib/forecast/scenario-comparison.ts` (`compareScenario`), `src/lib/scenario-comparison.ts`, the Scenario lab page | Unit: contributions add up to the closing-balance difference, skipped adjustments, purity, overdue events; PostgreSQL: one account's comparison, isolation, ownership; browser: side by side, effects add up, WCAG, 375 px | PR on top of the Scenario lab; delayed invoices only, exchange-rate shocks are not part of the comparison yet |
| US-13 reliable ECB exchange rates | Migration 006 and `src/lib/fx/*` | Parser/provider/cache unit tests; PostgreSQL constraints, atomic persistence, stale fallback and restricted-role integration tests | Scenarios & Exchange Rates Phase 2 branch; the Scenario lab reads the rates |
| US-14 percentage-based FX shocks | Migration 008, `src/lib/fx/fx-shock.ts`, `src/lib/fx/shock-store.ts` | Decimal shock/result-contract unit tests; PostgreSQL constraint, provenance, invalidation, malformed-id and cross-workspace tests | Scenarios & Exchange Rates Phase 3 branch; the Scenario lab saves and shows the shocks |
| US-02 workspace | `src/lib/workspace-store.ts`, `src/app/actions/workspace.ts`, `src/components/workspace-form.tsx`, migration 002 renamed to `workspaces` by 005 | Integration: two-user isolation, invalid and anonymous writes, SQL name and uniqueness constraints, origin check; unit name validation; Playwright persistence after reload and expired-session submit | Foundation & Security branch; the table was a portfolio before 005 renamed it |

Every later feature needs its own issue, acceptance criteria, tests, and reviewed PR.
