# Engineering decisions

Foundation and holdings choices below are implemented and awaiting student review. Quote/valuation choices remain proposed.

| Decision | Why | Alternative | Accepted cost |
| --- | --- | --- | --- |
| One Next.js application with TypeScript | One deployable application and shared types | Separate frontend/backend | Framework coupling; server/client boundaries still need review |
| Application-managed accounts and PostgreSQL | Meets the requirement to own backend behavior without a hosted auth service | Managed authentication provider | Team must implement and test password hashing, sessions, revocation, and abuse controls |
| Central server-only data access with explicit ownership predicates | A simple authorization boundary that students can explain and test | PostgreSQL row-level security as an additional layer | Every operation must use this boundary; omitted predicates are a security defect |
| One portfolio per user initially | Small, complete management workflow | Multiple portfolios | Reduced functionality; schema can later relax the uniqueness constraint |
| USD instruments and current positions | Defensible valuation without FX or transaction accounting | Multi-currency ledger | No realized P/L or historical performance |
| Decimal financial arithmetic | Predictable decimal precision | Binary floating point throughout | Additional library and explicit conversion rules |
| Allocation and absolute P/L contribution (planned) | Matches the small tracker specification | Advanced risk models | Limited analytical scope |
| Server-side quote adapter | Keeps secrets private and isolates provider behavior | Direct browser requests | Server quota management and latency |

## Open decisions

- Node 24.x is selected for development, CI, and Vercel; dependencies are pinned in the lockfile.
- Compare quote providers using actual USD stock/ETF coverage, free/education quotas, freshness, symbol resolution, licensing, caching permissions, and assessment availability. Do not assume any provider offers real-time data for free.
- Define numeric precision, input bounds, quote expiry, request timeout, and refresh limits before their implementation.
- Node scrypt, `pg`, 24-hour database sessions, and per-address throttling are implemented. Recovery and email verification remain out of scope.
- Staging uses a dedicated Neon PostgreSQL host with provider authentication disabled; the application still uses direct pg/SQL and internal authentication. Vercel hosts only the application.
- Confirm available GitHub protections and hosting/database account limits.

## Defense record for significant changes

In the relevant PR, record: problem solved; implementation; why chosen; alternatives; trade-offs; tests and results; migration/deployment steps. Explain architectural problems before changing the design, and update this document when the decision changes.

## Issue 1 — Remove the shared authentication lockout

Problem: 100 attempts from one caller could disable authentication for everyone. Decision: retain a PostgreSQL fixed-window counter per normalized email only, allowing 10 attempts per 15 minutes. Alternatives: a global cap (rejected for availability), external rate-limit infrastructure (unnecessary here), or trusted IP limits (requires a defined proxy trust boundary). Accepted trade-offs: targeted address lockout and rotating-address abuse remain possible. Tests cover concurrency, normalization, window expiry, independence, and more than 100 unrelated attempts.

## Issue 1 — Production-mode browser tests

A reusable dev server could point at a real development database and issue different cookies. Tests now force a separate `_test` database and start their own production server. This costs one build and server startup but verifies production Secure cookies, server actions, and persistence without reusing developer sessions.

## Issue 1 — Runtime and hosting

Node 24 is declared in `.nvmrc` and `engines.node: 24.x`; GitHub Actions reads `.nvmrc`. Vercel also uses the package engine range, as documented in [its Node runtime configuration](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). Patch updates are allowed for security maintenance. The existing Vercel `fseproject` project was verified as linked to `spqrcode/fseproject`; other projects are outside this task.

## Issue 1 — Deploy from Git only, not from the working tree

Problem: `vercel deploy` uploads the working directory, so `.gitignore` does not protect anything; a staging deployment shipped ignored credential files to a third party. Decision: staging is built by the GitHub integration from a pushed commit, and the staging alias points at a Git-source deployment. Alternatives: keep CLI deploys and rely on `.vercelignore` (rejected — one forgotten pattern is a credential leak), or keep secrets outside the project directory (helps, but does not remove the upload class). Accepted trade-off: publishing requires a commit and push, which is slower than a local deploy but produces the commit to CI to deployment chain the assessment expects. `.vercelignore` is retained as defence in depth. Verified by inspecting the deployment upload manifest and by the deployment source field reporting `git`.

## Issue 2 — Derive the portfolio from the session instead of validating a submitted id

Problem: a holdings form that carries `portfolio_id` invites forgery, and the usual answer is to check the id against the caller. Decision: the `INSERT` selects `portfolio_id` from the caller's own session, and no `UPDATE` sets it. Alternatives: accept the id and verify it (rejected — the check is one forgotten line away from a cross-user write), or a database policy per row (rejected as new infrastructure for one table; the application boundary already exists and is tested). Accepted trade-off: this shape only works while a user has one portfolio, so multiple portfolios would need an explicit, tested selection step. Tests submit another user's portfolio id to both forms and assert nothing moves.

## Issue 2 — Amounts are decimal text, never JavaScript numbers

Problem: `10.1` cannot be represented exactly in binary floating point, and money read through a float is wrong before any arithmetic happens. Decision: `numeric(20, 8)` in PostgreSQL, strings in TypeScript, and validation performed on the text with a regular expression. Alternatives: JavaScript numbers (rejected — silent rounding), or a decimal library now (deferred — nothing computes with these values yet). Accepted trade-off: comparisons in validation use `Number()` only for "greater than zero" and "at most the maximum", where a double is exact enough at these magnitudes; real arithmetic waits for the valuation increment and will use a decimal type. Tests assert `0.00000001` survives the round trip unchanged.

## Issue 2 — Validate the text, then let the database repeat it

Problem: `Number("NaN")` is `NaN`, `Number("1e5")` is `100000`, and PostgreSQL sorts `NaN` above every other numeric, so `CHECK (quantity > 0)` accepts it. Any single one of these layers can be talked past. Decision: reject the input as text with `^\d{1,12}(\.\d{1,8})?$` before conversion, and independently exclude `NaN` and non-positive values in the `CHECK` constraints. Alternatives: `Number.isFinite` after parsing (weaker — it accepts `1e5` and signs), or constraints alone (no useful message for the user). Accepted trade-off: the same rule is written twice and the two must be kept in agreement; the digit bounds match `numeric(20, 8)` exactly and both are stated in the requirements. Tests exercise the constraints directly with SQL that bypasses the form.

## Issue 2 — One answer for "not yours" and "does not exist"

Problem: distinguishing the two tells an attacker which identifiers are real. Decision: both produce "That holding is no longer available." and change nothing; a malformed id is mapped to the same answer before it can raise a PostgreSQL cast error. Alternative: a specific "not authorised" response (rejected — clearer for the user, but it confirms the id exists). Accepted trade-off: a user who genuinely broke their own page gets a vaguer message. Tests assert the two responses are equal and that the owner's row is untouched.
