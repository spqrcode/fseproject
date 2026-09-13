# Architecture

Status: proposed; no components or policies implemented yet.

## Request flow

The browser renders Next.js pages. The application manages accounts and database-backed sessions. Next.js server operations validate the session and input before accessing PostgreSQL through a shared server-only data-access layer. Every portfolio query includes the authenticated user ID; holding queries verify ownership through their parent portfolio.

Next.js server code calls the external quote provider. The browser never receives the provider secret. Provider responses are validated and converted into a small internal quote type before use in calculations or display.

## Responsibilities

- Pages and UI components: forms, loading/error states, accessible tables, and charts.
- Server operations: verified identity, input validation, database calls, and useful error responses.
- Market-data adapter: provider requests, timeout, response validation, normalization, freshness, and rate-limit handling.
- Calculation module: pure decimal arithmetic without network or database dependencies.
- Database: persistence, constraints, accounts, sessions, and migrations.

Use these boundaries within one application. Separate microservices are unnecessary for this scope.

## Proposed data model

- `users`: id, normalized unique email, password_hash, created_at. Passwords are hashed with a maintained password-hashing library; never implement cryptography ourselves.
- `sessions`: hashed random session token, user_id, expires_at. The browser receives the opaque token in an HttpOnly, Secure production cookie with an appropriate SameSite setting. Logout revokes the database session.
- `portfolios`: id, user_id referencing users, name, created_at, updated_at. Unique user_id enforces one portfolio per user.
- `holdings`: id, portfolio_id, canonical instrument identifier, quantity, average_purchase_price, created_at, updated_at. Unique portfolio/instrument pair prevents duplicates.
- Database numeric columns preserve decimal inputs. Precision and maximum values will be explicitly selected with the schema.
- Holding access checks ownership of the parent portfolio. Updates must validate both existing and resulting ownership.

Initial instruments must be provider-validated and USD-denominated. Canonical identifiers must disambiguate exchanges; do not assume a ticker string uniquely identifies every instrument.

Quote-cache persistence and expiry will be chosen after verifying provider terms and quotas. Never place user-specific portfolio responses in a shared public cache. Instrument-level quotes may be shared only if provider licensing permits it.

## Financial behavior

Store decimal values and carry out calculations using decimal arithmetic, with rounding at presentation boundaries. Confirm the decimal library during implementation. Holdings represent current positions and average purchase prices, not a transaction ledger.

A missing quote creates an incomplete valuation, not a zero-valued position. Aggregate freshness reflects constituent quotes. Concentration is a limited descriptive measure; it does not require historical data or imply future losses.
