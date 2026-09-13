# Requirements

Status: proposed baseline; implementation and verification pending.

## US-01 — Account and session

As a visitor, I can register, log in, and log out so that I can securely access my data.

Acceptance criteria:
- Valid registration follows the configured email-verification policy; invalid input produces a useful error.
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

## US-06 — Allocation and concentration

As a portfolio owner, I can see how portfolio value is distributed across instruments.

Acceptance criteria:
- Allocation uses position market value divided by complete portfolio market value.
- The largest position weight is displayed as a simple concentration indicator, with its meaning explained.
- Incomplete prices prevent complete allocation claims; zero-value portfolios show unavailable allocation.
- The UI does not describe concentration as a complete assessment of investment risk.

## US-07 — Ownership isolation

As a user, my portfolio and holdings are accessible only to me.

Acceptance criteria:
- Server-side data access enforces ownership for every read, insert, update, and delete; the database is not exposed to browser clients.
- Automated tests use two users and an unauthenticated client to attempt unauthorized operations.
- Tests cover forged ownership, guessed identifiers, and changes to parent portfolio references.
- Server responses, logs, and caches do not disclose another user's holdings.

## Engineering acceptance criteria

- At least three distinct functional views: authentication, portfolio management, and dashboard analytics.
- A persistent database, secure authentication, authorization, and meaningful external API integration are demonstrated.
- Pull requests run automated tests, lint, TypeScript checks, and a production build.
- GitHub history includes genuine contributions and reviews from all four students.
- The application is publicly reachable for assessment; private data still requires authentication.
- Requirements, architecture, decisions, tests, security, deployment, limitations, and AI use are documented.
- AI-generated changes receive the same review and verification as human-authored changes.
