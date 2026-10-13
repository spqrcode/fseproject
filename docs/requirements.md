# Requirements

Status: Issue 1 foundation implemented; later features remain planned. See the traceability table below.

## US-01 — Account and session

As a visitor, I can register, log in, and log out so that I can securely access my data.

Acceptance criteria:
- Valid registration stores a password hash and returns a generic response; duplicate registration does not overwrite credentials. Email verification is out of scope for this increment. Invalid input is rejected server-side.
- Valid credentials establish a session; invalid credentials do not disclose whether an account exists.
- Protected pages and server operations reject unauthenticated or expired sessions.
- Logout removes the current session and protected navigation requires login again.

## US-02 — Portfolio management

As a signed-in user, I can create, view, and rename my own portfolio.

Acceptance criteria:
- A user can create at most one portfolio; the database enforces this invariant.
- A valid nonempty bounded name is persisted and survives reload.
- Empty and invalid names are rejected server-side.
- Other users cannot read or modify the portfolio, including through direct application endpoint requests.

## US-03 — Holdings

As a portfolio owner, I can add, edit, and remove positions.

Acceptance criteria:
- A position contains a supported USD instrument, positive quantity, and positive average purchase price.
- Input must be finite and within documented precision and size limits; limits are agreed before implementation.
- Duplicate instruments in the same portfolio are rejected with guidance to edit the existing position.
- Valid changes persist after reload; invalid changes leave stored data unchanged.
- Users cannot move or attach holdings to another user's portfolio.
- Removing a holding requires an explicit user action and handles persistence errors visibly.

## US-04 — Quotes

As a portfolio owner, I can retrieve market prices for my holdings.

Acceptance criteria:
- At least one real external API provides quotes through server-side code; provider credentials never reach the browser.
- Every usable quote has a validated instrument, currency, positive finite price, and observation timestamp.
- Quotes show observation time and freshness; refresh time is not presented as market observation time.
- Timeouts, rate limits, network errors, unsupported instruments, and malformed responses produce useful states.
- Refreshes are bounded and throttled; stale data is labeled and missing prices are never treated as zero.

## US-05 — Valuation

As a portfolio owner, I can see portfolio value and unrealized profit/loss.

Acceptance criteria:
- Position cost is quantity × average purchase price; value is quantity × quote; unrealized P/L is value − cost.
- Portfolio amounts are sums of position amounts; P/L percentage uses total cost as the denominator.
- Empty portfolios show an onboarding state; undefined percentages show unavailable, not NaN or infinity.
- Missing quotes prevent a complete total; any available subtotal is explicitly labeled partial.
- Stale quotes remain visibly stale, including at aggregate level.
- Calculation and rounding behavior is covered by automated tests.

## US-06 — Allocation and P/L contribution

As a portfolio owner, I can see how portfolio value is distributed across instruments.

Acceptance criteria:
- Allocation uses position market value divided by complete portfolio market value.
- Each position’s unrealized P/L is shown as its absolute contribution to total P/L; contributions sum to the portfolio P/L. Do not divide by total P/L, which can be zero.
- Incomplete prices prevent complete allocation claims; zero-value portfolios show unavailable allocation.
- The UI does not describe allocation or P/L contribution as a complete assessment of investment risk.

## US-07 — Ownership isolation

As a user, my portfolio and holdings are accessible only to me.

Acceptance criteria:
- Server-side data access enforces ownership for every read, insert, update, and delete; the database is not exposed to browser clients.
- Automated tests use two users and an unauthenticated client to attempt unauthorized operations.
- Tests cover forged ownership, guessed identifiers, and changes to parent portfolio references.
- Server responses, logs, and caches do not disclose another user's holdings.

## US-08 Reporting currency and navigation (FinTwin Global)

As a signed-in user, I can move between the FinTwin Global sections and choose the currency in which my figures are reported. Acceptance criteria and implementation are in [product experience](product-experience.md#us-08-reporting-currency).

Supported reporting currencies: EUR, USD and SGD, agreed at the team meeting on 2 October 2026. SGD is kept for the APAC use case in the proposal and is dropped only if its exchange rates cause problems. All three are published as ECB euro reference rates, so the FX source can supply EUR/USD and EUR/SGD directly and USD/SGD in both directions through the euro. The Forecast Engine and Scenarios & FX build against this list. To change it, edit this line, `REPORTING_CURRENCIES` in `src/lib/currency.ts` and the forecast currency list; no migration is needed, because the database only checks the three-letter shape.

## US-11 Cash accounts and cash events (data layer)

As a signed-in user, I have a workspace with cash accounts in EUR, USD or SGD and cash events (expected income and expenses) on them. Acceptance criteria for this increment (no page yet):
- Amounts are signed decimal strings with at most 2 decimals: income above zero, expense below zero, zero invalid; NaN, exponents and extra decimals are rejected.
- An event's date is a date without time. Statuses are expected, received, paid and cancelled; received applies only to income and paid only to expenses; cancelled events are left out of forecasts.
- An event's currency is its account's currency; an event can never belong to another workspace's account.
- Only the owner can list, create, change or delete accounts and events; another user's id and a non-existent id give the same result.
- A status moves only from expected to received, paid or cancelled.
- Received, paid and cancelled events cannot be edited or deleted; corrections are made with a new event.
- A workspace can store an optional danger threshold.
- A settled event's date is the date the money moved: marking a future-dated event received or paid moves it to today (UTC).

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

- `-10` means minus 10%, not a ratio of `-0.1`; percentages must be plain decimals greater than -100.
- The FX service resolves direct, reciprocal and cross rates before the Forecast Engine consumes them. The engine does not derive SGD/EUR or USD/SGD itself.
- Calculations use Decimal arithmetic with no implicit display rounding and leave snapshots unchanged.
- CURRENT and STALE results include source and adjusted decimal strings, requested pair, effective date, provider and source snapshot IDs.
- UNAVAILABLE returns null source and adjusted rates with an explicit failure; it never fabricates a fallback number.
- Persisted shocks are workspace-isolated and keep their immutable snapshot provenance.

## Engineering acceptance criteria

- At least three distinct functional views: authentication, portfolio management, and dashboard analytics.
- A persistent database, secure authentication, authorization, and meaningful external API integration are demonstrated.
- Pull requests run automated tests, lint, TypeScript checks, and a production build.
- GitHub history includes genuine contributions and reviews from all four students.
- The application is publicly reachable for assessment; private data still requires authentication.
- Requirements, architecture, decisions, tests, security, deployment, limitations, and AI use are documented.
- AI-generated changes receive the same review and verification as human-authored changes.

## Issue 1 traceability

| Requirement | Implementation | Verification | Delivery |
| --- | --- | --- | --- |
| US-01 registration, login, logout | `src/app/actions/auth.ts`, password/session modules | Unit security tests; integration server-action tests; all four E2E scenarios | `feat/auth-foundation`; staging record in deployment document |
| US-01 session expiration/revocation | Session SQL and protected page/action checks | Integration expiry/replay; browser expiry, logout replay, expired open form | Same branch and deployment |
| US-07 existing ownership boundary | `src/lib/workspace-store.ts`, `src/lib/cash-events-store.ts`, `requireUser` | Real database two-user, anonymous, forged-owner and expired-token tests | Existing foundation only; no holdings claims |
| Reproducible automated checks | `scripts/test.mjs`, `.github/workflows/ci.yml` | Migration rerun; full `npm run verify` | GitHub PR CI |
| US-02 portfolio setup | Existing create/read/rename implementation | Existing behavior checked as an authentication regression | Issue 2 not started or declared complete |
| US-03–06 | Not implemented | Pending | Later increments |
| US-08 reporting currency | `src/lib/preferences-store.ts`, `src/app/actions/preferences.ts`, migration 003 | Unit currency validation; integration ownership, origin, expiry and constraint tests; Playwright persistence and expired-session tests | Product experience branch |
| US-08 public home page | `src/app/page.tsx` | Playwright content, links, signed-in redirect and phone-width tests | Product experience branch |
| US-10 appearance | Migration 004, `src/lib/preferences-store.ts`, `updateAppearance`, `src/components/appearance-form.tsx`, dark palette | Unit choice validation; integration ownership, origin, expiry and constraint tests; Playwright device-following, saved dark and light overrides and persistence | Product experience branch |
| US-09 active sessions | `src/lib/account-sessions.ts`, `src/app/actions/account.ts`, settings page | Integration own-sessions listing, other-user isolation, expired caller, origin and redirect tests; Playwright two-browser sign-out test | Product experience branch |
| US-08 navigation and states | `src/components/navigation.tsx`, `(protected)` loading, error, forecast, scenarios and settings pages | Playwright navigation, signed-out redirects, keyboard and phone-width tests | Product experience branch |
| US-11 cash accounts and events | Migration 005, `src/lib/cash-events-store.ts`, `src/lib/workspace-store.ts`, cash schemas in `src/lib/validation.ts` | Integration constraints by direct SQL, two-user ownership matrix, anonymous/unknown/expired sessions, malformed ids, status transitions, cascade, and a run as the staging role; unit amount and date validation | Foundation & Security branch; the Cash events page is separate work |
| US-11 settled events immutable | `updateCashEvent` and `deleteCashEvent` in `src/lib/cash-events-store.ts` (status condition in the `WHERE` clause) | Integration: editing and deleting received, paid and cancelled events refused with the row unchanged; expected events still work; another user's settled event gives the same null as a missing one | Foundation & Security branch (review feedback on PR #10) |
| US-11 forecast input (decisions of 2026-10-08, implemented 2026-10-10) | `src/lib/forecast-input-store.ts` (starting balance, overdue events, threshold), `src/lib/forecast-input.ts` (status mapping), date rule in `setCashEventStatus`; see [decisions](decisions.md#2026-10-10--forecast-input-implemented-a-settled-events-date-is-the-date-the-money-moved) | Integration: starting balance with events before, on and after the start date (on or before counts), cancelled and other accounts and users ignored, early-settled event in the balance, overdue events, ranges, ownership matrix; unit: status mapping and range; also run as the staging role | Foundation & Security branch `feat/forecast-input`. The call into the engine is not delivered: it waits for PR #12 |
| US-12 delayed-invoice scenarios | Migration 007, `src/lib/scenario-store.ts`, immutable scenario projection in `src/lib/forecast/scenario.ts` | Unit immutability and delta tests; PostgreSQL ownership, composite-FK, eligibility, date-only, cascade and base-forecast isolation tests | PR #9; aligned to the merged PR #12 engine; adjustments that cannot apply are skipped and reported (decision of 2026-10-12) |
| US-12 base versus scenario comparison | `src/lib/forecast/scenario-comparison.ts` (`compareScenario`), `src/lib/scenario-comparison.ts`, the Scenario lab page | Unit: contributions add up to the closing-balance difference, skipped adjustments, purity, overdue events; PostgreSQL: one account's comparison, isolation, ownership; browser: side by side, effects add up, WCAG, 375 px | PR on top of the Scenario lab; delayed invoices only, exchange-rate shocks are not part of the comparison yet |
| US-13 reliable ECB exchange rates | Migration 006 and `src/lib/fx/*` | Parser/provider/cache unit tests; PostgreSQL constraints, atomic persistence, stale fallback and restricted-role integration tests | Scenarios & Exchange Rates Phase 2 branch; no UI in this increment |
| US-14 percentage-based FX shocks | Migration 008, `src/lib/fx/fx-shock.ts`, `src/lib/fx/shock-store.ts` | Decimal shock/result-contract unit tests; PostgreSQL constraint, provenance, invalidation, malformed-id and cross-workspace tests | Scenarios & Exchange Rates Phase 3 branch; no UI in this increment |
| US-02 workspace (renamed) | `src/lib/workspace-store.ts`, `src/app/actions/workspace.ts` | The existing ownership and origin tests, renamed | Same branch |

Every later feature needs its own issue, acceptance criteria, tests, and reviewed PR. No holding deletion or cross-user holding test is claimed before holdings exist.
