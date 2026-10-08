# Security

## Implemented and tested in Issue 1

- Passwords: Node's built-in scrypt (`N=131072`, `r=8`, `p=1`), random 16-byte salt, 64-byte derived key, versioned encoding, constant-time comparison. Password input is 15–128 characters; it is not trimmed or truncated. Unknown accounts still incur a hash calculation.
- Sessions: 32 random bytes; only their SHA-256 digest is stored. A fixed 24-hour expiry is checked in SQL. Login rotates the current browser session; logout revokes it before clearing the cookie. Other browser sessions remain valid.
- Cookie: HttpOnly, SameSite=Lax, path `/`, no Domain attribute, Secure in production, and 24-hour Max-Age/Expires. Production-mode Playwright checks the actual cookie and rejects replay after logout. Localhost Chromium supports Secure cookies for this test; staging additionally verifies HTTPS.
- Authorization: server pages and actions require an authenticated user. Workspace SQL scopes reads and writes through an unexpired session. Submitted ownership fields do not select another user's portfolio. Tests exercise two users, anonymous access, expired cookies, and direct server-action calls.
- CSRF: Next.js server actions use POST and framework origin checks; application mutations additionally require an exact match with configured `APP_ORIGIN`. Missing/foreign origins are rejected. No wildcard origin or caller-supplied Host fallback is trusted.
- Input/SQL: Zod checks email, password, and portfolio name server-side; database constraints enforce uniqueness and valid names. Values use PostgreSQL `$1` parameters. An SQL-looking portfolio name is stored as literal data in a regression test.
- Failures: authentication returns generic errors; SQL connection details and credentials are not returned to users. Failed authentication does not create a session.
- Headers: frame embedding denied, content sniffing disabled, same-origin referrer policy, camera/microphone/geolocation disabled.

## Authentication throttle and its trade-off

The old application-wide cap was removed because one attacker could deny access to everyone. Login is now throttled per normalized email address with a fixed 15-minute window, and only failed logins count:

- Before the password is verified, login reads the counter without changing it and refuses the request if the address already has 10 failures in the current window (the correct password is also refused). The refusal is read-only and does not extend the window.
- A wrong password, or an unknown address, increments the counter through a single atomic PostgreSQL upsert; counters saturate at 11.
- A successful login closes that address's window (`UPDATE ... SET reset_at = now()`), so the next failure starts a fresh count and legitimate sign-ins can never lock an account. It uses `UPDATE` rather than `DELETE` because the runtime role `fse_runtime` has only SELECT/INSERT/UPDATE on `auth_limits`. Closed rows stay until the address is used again. Rows from before this change with the `account:` key prefix are no longer read and are harmless.
- Registration uses its own counter (`register:` key prefix, 10 attempts per address per window) so repeated registration requests cannot lock a login for a known address. Login counters use the `login:` prefix.
- Unrelated addresses have independent limits.

Known limit of the check-then-increment design: the check and the increment are separate statements, so a burst of parallel wrong guesses can pass the check before any of them is counted. The overshoot is bounded by the number of requests in flight at once (each takes a full scrypt computation) and the next request after the burst is blocked. Registration uses increment-then-compare and is exact under concurrency.

This is basic account throttling, not complete abuse protection. It permits targeted temporary lockout and can be bypassed by rotating addresses. No untrusted proxy/IP headers are used. Before higher-risk use, choose trusted network-level limits for the actual hosting environment. See [OWASP's authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) for the lockout/availability trade-off.

## Ownership chain for cash data

Cash accounts and events belong to a workspace, and a workspace to one user. `src/lib/cash-events-store.ts` reaches every row through `sessions` (unexpired) → `workspaces` → `cash_accounts` / `cash_events`; no user, workspace or ownership id is accepted from input, and unknown input keys such as `workspaceId` are stripped by the schema. An account id in input is only a choice among the caller's own accounts: the query joins it to the caller's workspace.

- Another user's id and a non-existent id give the same result (`null`, or `false` for delete), and a malformed UUID is rejected before SQL, so it cannot raise a distinguishable database error. A missing or expired session throws `Authentication required.`; that check runs only after a query found nothing.
- The database is the second layer. The composite foreign key `(account_id, workspace_id)` makes an event for another workspace's account impossible even for faulty SQL, and the staging role has column-level `UPDATE`, so `account_id`, `workspace_id` and an account's `currency` cannot be rewritten by the application role at all.
- Status changes are enforced in the application (only `expected` → `received`, `paid` or `cancelled`); the database enforces the sign rule and the allowed values, not the transition order. Settled events cannot be edited or deleted: the `UPDATE` and `DELETE` carry `status = 'expected'` in their `WHERE` clause, so the check is atomic, and a second query then separates the caller's own settled event (`StatusConflictError`) from a foreign or missing one (`null`/`false`, identical to before). The same status rule is not a database constraint, so a privileged connection could still change a settled row.
- Tests: `tests/integration/cash-events.test.ts` (constraints by direct SQL, two-user matrix, anonymous/unknown/expired sessions, forged and malformed ids, cascade), also run with the application connected as a role with exactly the staging grants.

## Secrets and database access

`.env*` files, `.local/`, `.vercel/`, and test outputs are ignored; only `.env.example` is committed. No `NEXT_PUBLIC_` credential variables are used. The database driver, hashing code, and session/data-access modules import `server-only`. Do not put privileged migration credentials in the runtime environment. Use certificate-verified TLS for hosted PostgreSQL. Passwords, session tokens, and database URLs must not appear in logs, PRs, or test reports; browser traces are disabled because form payloads contain credentials.

## Explicit limitations

No email verification, password reset, MFA, breached-password check, periodic expired-row cleanup, or independent penetration test. No PostgreSQL RLS: the application and runtime database credential are the authorization boundary. Basic headers are not a complete CSP. The database can still be queried by its administrator. See deployment evidence for controls actually verified on staging.

## Issue 1 — Credential exposure incident and remediation

A staging deployment created with `vercel deploy` from the working tree uploaded files that Git ignores. Inspecting the deployment's own upload manifest after publishing showed `.local/staging.env`, `.local/staging-runtime-url`, `.local/staging-origin`, the local helper scripts, and the entire `.local/postgres` data directory. Exposed material: the Neon database owner connection string, the `fse_runtime` connection string, and the local test database contents (generated `integration-*@example.com` and `e2e-*@example.com` accounts with scrypt hashes of test-only passwords). No student, teacher, or real account data existed in that database.

Deployment protection is disabled on this project, so we state only that there is no evidence of third-party access; we cannot prove none occurred. The exposure window was approximately fifteen minutes.

Remediation, in order:

1. The upload manifest of the published deployment was inspected and the ignored files were found.
2. `.vercelignore` was added; a later manifest confirms `.local`, `playwright-report`, and `test-results` upload no files.
3. The affected deployment was deleted; its ID now returns 404 from the deployments API.
4. Both database passwords were rotated with `ALTER ROLE`. The previous owner and runtime credentials were then confirmed to be rejected by the server.
5. The Vercel `DATABASE_URL` preview variable was replaced with the new restricted runtime connection string.
6. The staging alias was moved onto a Git-source deployment, and CLI deployment from the working tree was stopped for this project.

Root cause: `vercel deploy` uploads the working directory, not the Git index, so `.gitignore` does not apply. A Git-source deployment builds from the repository and structurally cannot include ignored files. `.vercelignore` remains as a second layer rather than the only control.
