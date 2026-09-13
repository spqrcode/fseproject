# Security

## Implemented and tested in Issue 1

- Passwords: Node's built-in scrypt (`N=131072`, `r=8`, `p=1`), random 16-byte salt, 64-byte derived key, versioned encoding, constant-time comparison. Password input is 15–128 characters; it is not trimmed or truncated. Unknown accounts still incur a hash calculation.
- Sessions: 32 random bytes; only their SHA-256 digest is stored. A fixed 24-hour expiry is checked in SQL. Login rotates the current browser session; logout revokes it before clearing the cookie. Other browser sessions remain valid.
- Cookie: HttpOnly, SameSite=Lax, path `/`, no Domain attribute, Secure in production, and 24-hour Max-Age/Expires. Production-mode Playwright checks the actual cookie and rejects replay after logout. Localhost Chromium supports Secure cookies for this test; staging additionally verifies HTTPS.
- Authorization: server pages and actions require an authenticated user. Portfolio SQL scopes reads and writes through an unexpired session. Submitted ownership fields do not select another user's portfolio. Tests exercise two users, anonymous access, expired cookies, and direct server-action calls.
- CSRF: Next.js server actions use POST and framework origin checks; application mutations additionally require an exact match with configured `APP_ORIGIN`. Missing/foreign origins are rejected. No wildcard origin or caller-supplied Host fallback is trusted.
- Input/SQL: Zod checks email, password, and portfolio name server-side; database constraints enforce uniqueness and valid names. Values use PostgreSQL `$1` parameters. An SQL-looking portfolio name is stored as literal data in a regression test.
- Failures: authentication returns generic errors; SQL connection details and credentials are not returned to users. Failed authentication does not create a session.
- Headers: frame embedding denied, content sniffing disabled, same-origin referrer policy, camera/microphone/geolocation disabled.

## Holdings authorization and validation (Issue 2)

- Ownership: every holdings statement reaches a row only through `holdings → portfolios → sessions` with `expires_at > now()`. There is no code path that accepts an owner from the browser.
- Creation: `portfolio_id` is selected from the caller's own session inside the `INSERT`, so a `portfolio_id` submitted with the form is ignored rather than checked.
- Reassignment: no `UPDATE` sets `portfolio_id`. A holding cannot be moved between portfolios by any request the application accepts.
- Identifiers: another user's holding id and an id that never existed produce the same message and the same absence of change, so the forms cannot be used to enumerate holdings. A malformed id is rejected by the schema before it reaches SQL, where it would otherwise raise a distinguishable cast error.
- Input: tickers are uppercased and matched against a fixed pattern; amounts are validated as decimal text before any numeric conversion, which rejects `NaN`, `Infinity`, exponent notation and signs by construction. Database `CHECK` constraints repeat the positivity rule and exclude `NaN` explicitly, because PostgreSQL sorts `NaN` above every other numeric and would otherwise satisfy `> 0`.
- Duplicates: enforced by `UNIQUE (portfolio_id, symbol)` and reported from the resulting `23505`, not by a prior `SELECT`, which would be racy.
- Amounts are read and written as strings so no floating-point rounding is introduced before the valuation increment.
- Origin and session checks are the same ones the existing actions use; holdings add no new authentication mechanism.

## Authentication throttle and its trade-off

The old application-wide cap was removed because one attacker could deny access to everyone. The current fixed window allows 10 valid-form authentication attempts per normalized email address in 15 minutes, shared between registration and login. PostgreSQL upsert makes concurrent attempts atomic. Rejected attempts do not extend the window; counters saturate at 11. Unrelated addresses have independent limits.

This is basic account throttling, not complete abuse protection. It permits targeted temporary lockout and can be bypassed by rotating addresses. No untrusted proxy/IP headers are used. Before higher-risk use, choose trusted network-level limits for the actual hosting environment. See [OWASP's authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) for the lockout/availability trade-off.

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
