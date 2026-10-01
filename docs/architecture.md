# Architecture

## Implemented foundation

One Next.js application runs on Node 24. Server components render private pages; server actions process forms. PostgreSQL stores accounts, sessions, and the existing portfolio.

Browser → Next.js server action/component → server-only application logic → PostgreSQL.

- `src/app`: routes, server actions, loading/error responses.
- `src/components`: forms and navigation; passwords and tokens are not stored in browser JavaScript state or local storage.
- `src/lib/password.ts`: Node scrypt password hashing and constant-time hash comparison.
- `src/lib/session-store.ts`: random tokens, digest storage, expiry checks, revocation.
- `src/lib/auth.ts`: cookie lookup and server-side authentication requirement.
- `src/lib/portfolio-store.ts`: ownership-scoped access to the existing portfolio.
- `src/lib/validation.ts`: server input schemas.
- `src/lib/preferences-store.ts`: session-scoped read and update of the reporting currency.
- `src/lib/currency.ts`, `src/lib/format.ts`: offered currencies and the shared presentation rules for amounts, percentages and timestamps (safe to use in browser components).
- `src/components`: shared page heading, empty state and placeholder figures used by every private page; `src/app/globals.css` holds the design tokens and styles. See [product experience](product-experience.md).
- `scripts/migrate.mjs`, `db/migrations`: reproducible schema changes.

A session is an opaque random value, not a JWT. The browser sends an HttpOnly cookie; PostgreSQL stores its SHA-256 digest. Every protected operation checks the stored expiry. Logout deletes the database session, so replaying the old cookie fails.

Checks exist in protected pages and mutations, and portfolio SQL checks ownership again. A layout alone is not the security boundary. User-specific data is not put in a shared application cache.

## Later increments

Holdings, a server-side market-data adapter, pure decimal financial calculations, and `/analytics` are planned. They are not implemented in Issue 1. A single currency and current positions keep the later financial model small. See requirements for the planned calculations and failure states.
