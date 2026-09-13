# Security plan

Status: intended controls, not a security certification or record of completed implementation.

## Authentication and authorization

The application owns registration, password verification, and session management. Use a maintained password-hashing library with an appropriate slow password hash and library-managed salts. Never store plaintext passwords or implement cryptographic primitives ourselves.

Create cryptographically random opaque session tokens, store only their hashes in PostgreSQL, and enforce expiry server-side. Use HttpOnly cookies, Secure in production, and an appropriate SameSite policy. Rotate sessions on login and revoke them on logout. Rate-limit authentication attempts and avoid account-enumerating errors. Exact parameters must be selected and tested before implementation.

Derive the user ID from the verified session. A server-only data-access layer must scope every portfolio read and mutation to that ID. Holding operations verify parent ownership, including any resulting parent after an update. Never trust a submitted owner ID. Test guessed identifiers and cross-user access through real application operations.

The browser has no direct database access. Use a restricted runtime database role and separate migration privileges. Parameterized SQL prevents injection but does not replace ownership checks.

## Inputs and requests

Validate all mutations server-side, and add database constraints as a second layer. Reject nonfinite numbers, out-of-bounds values, invalid instruments, and unknown fields where appropriate. Use parameterized database operations. Review framework origin/CSRF protections for the chosen mutation mechanism and do not introduce state-changing GET requests.

Quote requests must target a fixed provider origin and validated identifiers, with timeouts and bounded request volume. Do not accept arbitrary remote URLs from users.

## Secrets and data handling

Keep market-data and database credentials in local ignored environment files and deployment secret settings. Commit only a placeholder environment example. Database connection strings and session secrets, if required, must remain server-only.

Never log tokens, passwords, full authentication headers, or unnecessary personal/portfolio data. Return sanitized provider errors. User-specific responses must not leak through shared caches. Rotate any exposed credential and remove it from active use; deleting a committed secret alone is insufficient.

## Review evidence

Each feature PR records input boundaries, identity verification, ownership enforcement, secret exposure checks, error handling, and relevant automated tests. Add discovered issues and their actual fixes; do not claim a review found nothing without performing it.

## Outstanding work

Session configuration, abuse limits, email verification, recovery, dependency checks, and production headers require implementation and verification. See limitations for institutional readiness gaps.
