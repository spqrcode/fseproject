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

## Authentication throttle and its trade-off

The old application-wide cap was removed because one attacker could deny access to everyone. The current fixed window allows 10 valid-form authentication attempts per normalized email address in 15 minutes, shared between registration and login. PostgreSQL upsert makes concurrent attempts atomic. Rejected attempts do not extend the window; counters saturate at 11. Unrelated addresses have independent limits.

This is basic account throttling, not complete abuse protection. It permits targeted temporary lockout and can be bypassed by rotating addresses. No untrusted proxy/IP headers are used. Before higher-risk use, choose trusted network-level limits for the actual hosting environment. See [OWASP's authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) for the lockout/availability trade-off.

## Secrets and database access

`.env*` files, `.local/`, `.vercel/`, and test outputs are ignored; only `.env.example` is committed. No `NEXT_PUBLIC_` credential variables are used. The database driver, hashing code, and session/data-access modules import `server-only`. Do not put privileged migration credentials in the runtime environment. Use certificate-verified TLS for hosted PostgreSQL. Passwords, session tokens, and database URLs must not appear in logs, PRs, or test reports; browser traces are disabled because form payloads contain credentials.

## Explicit limitations

No email verification, password reset, MFA, breached-password check, periodic expired-row cleanup, or independent penetration test. No PostgreSQL RLS: the application and runtime database credential are the authorization boundary. Basic headers are not a complete CSP. The database can still be queried by its administrator. See deployment evidence for controls actually verified on staging.
