# Issue 1 verification record (2026-09-13)

This is the historical record of Issue 1, the authentication foundation, as verified on 13 September 2026. The `portfolio` names below are from that time; the table and page were later renamed to `workspaces` and `/workspace`. Current instructions for the assessment are in [SUBMISSION.md](../SUBMISSION.md).

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

Dedicated Neon resource provisioned on the free plan in Frankfurt with provider auth disabled. Migrations 001 and 002 (all that existed then) applied. Client TLS encryption and certificate verification confirmed. Restricted runtime role cannot create tables or modify migration history. Smoke results of the deployed application are below.

## Corrections worth retaining

- Removed the AI-generated global throttle because one caller could deny login to everyone; regression tests now exceed the old global limit across independent addresses.
- Replaced test reuse of a development server with a production server and mandatory isolated test database.
- Corrected a Playwright locator that also matched Next.js's accessibility announcer, without removing the announcer.
- Renamed Playwright's fixture callback to avoid an erroneous React-hook lint match.
- Aligned Node types/runtime with Node 24 and verified from a clean dependency install.

Retain the PR diff, CI run, this record, migration SQL, Playwright report, final deployed commit/URL, and genuine student review comments. AI review is not a substitute for a second student's review.

## Deployed staging verification (2026-09-13)

- Public URL: https://fseproject-staging.vercel.app
- Deployment at that time: source `git`, Preview target, branch `feat/auth-foundation` (staging now builds `main`, see [deployment](deployment.md)). The alias is moved onto the newest Git build of the branch. The smoke test below passed on `dpl_FAZ41RxeG9AmayQec2kKPhQhNvRV` (commit `487394f`) and again on `dpl_EntWcmwpRvv6b4KJGYsY66nnCj6d` (commit `05f0c95`). Later commits on this branch are documentation only and do not change application behaviour; re-run the smoke test before the assessment if the alias has moved again.
- Environment: Vercel Preview variables scoped to that branch only: `DATABASE_URL` (restricted `fse_runtime` role, sensitive) and `APP_ORIGIN` (the canonical alias). Node 24.x. Database: dedicated Neon PostgreSQL, Frankfurt, provider authentication disabled.

Automated smoke test against the public alias passed every step:

1. Anonymous `/dashboard` redirects to `/login`.
2. Registration succeeds and login reaches `/dashboard`.
3. The real HTTPS cookie is HttpOnly, Secure and SameSite=Lax.
4. A named portfolio persists across a page reload.
5. Expiring the session row server-side immediately blocks the browser that still holds a valid cookie.
6. Sign-out redirects to `/login`, and replaying the pre-logout cookie is rejected.
7. The generated smoke account and its throttle counter are deleted afterwards.

Registration and login succeeding through the alias also prove `APP_ORIGIN` matches the public origin, because both server actions reject a missing or foreign `Origin` header.

The credentials used by this deployment were issued after the rotation described in the security document; the previous owner and runtime passwords were confirmed rejected by the database before the deployment was published.

## Manual steps for a reviewer

1. Open https://fseproject-staging.vercel.app/dashboard. You must be redirected to `/login`.
2. Go to `/register`, use a fresh address and a passphrase of 15 to 128 characters, and expect the confirmation message.
3. Sign in at `/login`; you should land on `/dashboard`.
4. Open `/workspace`, save a workspace name, then reload and confirm the value is still there.
5. Sign out, then reopen `/workspace` and confirm login is required again.
6. In a second browser, register a different account and confirm it sees no workspace from the first account.
