# Issue 1 verification record — 2026-09-13

## Local results

Runtime: Node 24.21.0. Database: isolated PostgreSQL 16.15. Clean `npm ci` followed by `npm run verify` passed:

- ESLint: zero errors and warnings.
- Strict TypeScript: passed.
- Vitest unit tests: 8 passed.
- Database integration tests: 20 passed.
- Next.js production build: passed.
- Chromium end-to-end tests: 4 passed, no retries.
- Both test migrations applied, then reapplied without duplicate changes.

Security cases include two users, anonymous access, submitted owner ID, expired/revoked tokens, session rotation, SQL-looking input, generic authentication errors, missing/foreign origins, concurrent rate limiting, independent addresses, and more than 100 unrelated attempts. Browser tests verify actual Secure/HttpOnly/SameSite cookies, duplicate registration, persistence, logout replay rejection, and an expired session submitting an already-open form.

## Staging database checks

Dedicated Neon resource provisioned on the free plan in Frankfurt with provider auth disabled. Both migrations applied. Client TLS encryption and certificate verification confirmed. Restricted runtime role cannot create tables or modify migration history. Deployed application smoke results are recorded after deployment.

## Corrections worth retaining

- Removed the AI-generated global throttle because one caller could deny login to everyone; regression tests now exceed the old global limit across independent addresses.
- Replaced test reuse of a development server with a production server and mandatory isolated test database.
- Corrected a Playwright locator that also matched Next.js's accessibility announcer, without removing the announcer.
- Renamed Playwright's fixture callback to avoid an erroneous React-hook lint match.
- Aligned Node types/runtime with Node 24 and verified from a clean dependency install.

Retain the PR diff, CI run, this record, migration SQL, Playwright report, final deployed commit/URL, and genuine student review comments. AI review is not a substitute for a second student's review.
