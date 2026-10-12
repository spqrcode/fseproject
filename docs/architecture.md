# Architecture

## Implemented foundation

One Next.js application runs on Node 24. Server components render private pages; server actions process forms. PostgreSQL stores accounts, sessions, workspaces, cash data, and validated ECB exchange-rate snapshots.

Browser → Next.js server action/component → server-only application logic → PostgreSQL.

- `src/app`: routes, server actions, loading/error responses.
- `src/components`: forms and navigation; passwords and tokens are not stored in browser JavaScript state or local storage.
- `src/lib/password.ts`: Node scrypt password hashing and constant-time hash comparison.
- `src/lib/session-store.ts`: random tokens, digest storage, expiry checks, revocation.
- `src/lib/auth.ts`: cookie lookup and server-side authentication requirement.
- `src/lib/workspace-store.ts`, `src/lib/cash-events-store.ts`: session- and ownership-scoped access to workspaces, cash accounts and cash events.
- `src/lib/fx`: server-only ECB fetching, strict response parsing, atomic snapshot persistence, freshness classification, reciprocal rates and same-date cross-rates.
- `src/lib/validation.ts`: server input schemas.
- `src/lib/preferences-store.ts`: session-scoped read and update of the reporting currency.
- `src/lib/currency.ts`, `src/lib/format.ts`: offered currencies and the shared presentation rules for amounts, percentages and timestamps (safe to use in browser components).
- `src/components`: shared page heading, empty state and placeholder figures used by every private page; `src/app/globals.css` holds the design tokens and styles. See [product experience](product-experience.md).
- `scripts/migrate.mjs`, `db/migrations`: reproducible schema changes.

A session is an opaque random value, not a JWT. The browser sends an HttpOnly cookie; PostgreSQL stores its SHA-256 digest. Every protected operation checks the stored expiry. Logout deletes the database session, so replaying the old cookie fails.

Checks exist in protected pages and mutations, and workspace/cash SQL checks ownership again. A layout alone is not the security boundary. User-specific data is not put in a shared application cache. ECB snapshots are the exception: they are public global reference data, not user data.

The exchange-rate path is:

Application service → ECB provider adapter → strict CSV parser → PostgreSQL snapshot cache → typed `CURRENT`, `STALE` or `UNAVAILABLE` result.

The service first checks the cache. A snapshot fetched within one hour is `CURRENT`. Otherwise it attempts one ECB refresh for both EUR/USD and EUR/SGD and writes the validated observations atomically. If refresh fails, a prior validated snapshot is returned as `STALE` together with the refresh failure; without one, the result is `UNAVAILABLE` and its rate is `null`. Reciprocal rates retain the same snapshot metadata. USD/SGD is calculated only when both euro legs share an effective date.

## Later increments

The snapshot/cache layer is not yet wired to Scenario Lab or the forecast workflow on this branch. Holdings, market quotes and `/analytics` remain outside the current cash-forecast MVP. See requirements for the planned calculations and failure states.
