# Architecture

## Implemented foundation

One Next.js application runs on Node 24. Server components render private pages; server actions process forms. PostgreSQL stores accounts, sessions, the portfolio and its holdings.

Browser → Next.js server action/component → server-only application logic → PostgreSQL.

- `src/app`: routes, server actions, loading/error responses.
- `src/components`: forms and navigation; passwords and tokens are not stored in browser JavaScript state or local storage.
- `src/lib/password.ts`: Node scrypt password hashing and constant-time hash comparison.
- `src/lib/session-store.ts`: random tokens, digest storage, expiry checks, revocation.
- `src/lib/auth.ts`: cookie lookup and server-side authentication requirement.
- `src/lib/portfolio-store.ts`: ownership-scoped access to the existing portfolio.
- `src/lib/holdings-store.ts`: ownership-scoped holdings reads and writes; amounts stay strings.
- `src/lib/validation.ts`: server input schemas.
- `scripts/migrate.mjs`, `db/migrations`: reproducible schema changes.

A session is an opaque random value, not a JWT. The browser sends an HttpOnly cookie; PostgreSQL stores its SHA-256 digest. Every protected operation checks the stored expiry. Logout deletes the database session, so replaying the old cookie fails.

Checks exist in protected pages and mutations, and portfolio and holdings SQL check ownership again. A layout alone is not the security boundary. User-specific data is not put in a shared application cache.

Holdings follow the pattern the portfolio already set: the store module owns the SQL and the ownership predicate, the server action owns validation, origin checking and user-facing messages, and the client component owns nothing but form state. Adding a feature therefore means adding one store module and one action file, not a new authorization mechanism.

## Later increments

A server-side market-data adapter, pure decimal financial calculations, and `/analytics` are planned. They are not implemented yet. A single currency and current positions keep the later financial model small. See requirements for the planned calculations and failure states.
