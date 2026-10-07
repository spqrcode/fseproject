# Database

PostgreSQL 16, accessed through the server-only `pg` driver and parameterized SQL. No ORM or database API is exposed to the browser.

## Implemented tables

| Table | Purpose | Constraints |
| --- | --- | --- |
| users | Email, password hash, reporting currency and appearance | UUID primary key; unique lowercase email; currency of three uppercase letters, default EUR; appearance one of system, light, dark |
| sessions | SHA-256 digest of random session token | Digest primary key; user FK with cascade; expiry |
| auth_limits | Per-address attempt counter | Key primary key; positive count; window expiry |
| portfolios | Existing named portfolio | UUID primary key; unique user FK; trimmed 1–80 character name |
| schema_migrations | Applied migration history | Unique migration filename |

Migration `001_accounts.sql` creates users, sessions, and counters. `002_portfolios.sql` is the existing portfolio schema. `003_reporting_currency.sql` adds the reporting currency to `users` and, where the staging runtime role exists, grants it `UPDATE` on that single column. `004_appearance.sql` does the same for the appearance preference. Holdings are not present.

## Migrations

`npm run db:migrate` applies migrations to `DATABASE_URL`. The runner locks migrations with a PostgreSQL advisory lock, applies each file in its own transaction, and records it only after success. A second run skips applied files. Do not edit a migration after sharing or applying it; add another migration instead.

`npm run db:migrate:test` uses only `TEST_DATABASE_URL`, whose database name must end in `_test`. Migrations create tables in an existing database; they do not create the PostgreSQL database itself. Integration and browser fixtures remove their own users (cascading sessions and portfolios) and throttle keys after tests.

## Authorization boundary

Application queries derive ownership from an unexpired session in the database, never a browser-submitted user ID. The portfolio read and upsert, and the reporting currency read and update, join/select through `sessions`; an expired or unknown token cannot select an owner. This is application-level authorization, not PostgreSQL row-level security. Direct privileged SQL can bypass it, so database credentials stay server-only.

## Environments and privileges

Local development and automated tests use separate databases. The isolated CI PostgreSQL service uses `trust` authentication solely for its ephemeral runner; never use that configuration for an internet-accessible database.

Staging requires its own hosted database and TLS. Use a migration owner for schema changes and a separate runtime role with only the needed table privileges. Runtime credentials must not grant schema modification or access to unrelated projects. Record the actual staging setup in deployment documentation.

Expired sessions and throttle rows are ignored/reset but not periodically deleted yet. A later maintenance procedure should delete expired rows; no scheduler is introduced in Issue 1.
