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
| US-07 existing ownership boundary | `src/lib/portfolio-store.ts`, `requireUser` | Real database two-user, anonymous, forged-owner and expired-token tests | Existing foundation only; no holdings claims |
| Reproducible automated checks | `scripts/test.mjs`, `.github/workflows/ci.yml` | Migration rerun; full `npm run verify` | GitHub PR CI |
| US-02 portfolio setup | Existing create/read/rename implementation | Existing behavior checked as an authentication regression | Issue 2 not started or declared complete |
| US-03–06 | Not implemented | Pending | Later increments |
| US-08 reporting currency | `src/lib/preferences-store.ts`, `src/app/actions/preferences.ts`, migration 003 | Unit currency validation; integration ownership, origin, expiry and constraint tests; Playwright persistence and expired-session tests | Product experience branch |
| US-08 navigation and states | `src/components/navigation.tsx`, `(protected)` loading, error, forecast, scenarios and settings pages | Playwright navigation, signed-out redirects, keyboard and phone-width tests | Product experience branch |

Every later feature needs its own issue, acceptance criteria, tests, and reviewed PR. No holding deletion or cross-user holding test is claimed before holdings exist.
