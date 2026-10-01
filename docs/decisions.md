# Engineering decisions

Foundation choices below are implemented and awaiting student review. Financial/API choices remain proposed.

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

## Product experience: reporting currency and shared formatting

Problem: FinTwin Global reports figures in more than one currency, and the overview, forecast and scenario pages must show amounts the same way. Decision: store one reporting currency per account as a column on `users`, grant the staging runtime role `UPDATE` on that column only, keep the list of offered codes in the application, and format every amount through `src/lib/format.ts` from decimal strings with a fixed `en-GB` locale and UTC timestamps.

Alternatives: a separate `user_preferences` table (cleaner if many preferences appear, but one more join and grant for a single value); `UPDATE` on the whole `users` table (rejected, the runtime role could then rewrite password hashes); an allowlist in a database `CHECK` (rejected for now, every new currency from the FX provider would need a migration; the database checks the ISO 4217 shape instead); formatting with JavaScript numbers or the viewer's locale (rejected, numbers lose digits on large amounts and server and browser output could differ).

Appearance: stored per account like the currency, rendered by the server as `data-theme`, with colour tokens switched in CSS. Alternatives: `localStorage` plus an inline script before paint (per browser only, and an inline script would need an exception in a future Content Security Policy); following the device only (no way to override it). Unlike the currency, the database checks the complete list, because these three values are defined by the interface itself.

Accessibility checks: axe-core through `@axe-core/playwright` inside the existing Playwright suite, so CI runs them with no extra job. Alternatives: Lighthouse (slower, one page at a time, scores rather than failures) or manual review only (not repeatable). Automated rules cover part of WCAG; the remaining keyboard and focus behaviour stays in the browser specs.

Fonts: self-hosted through pinned Fontsource npm packages instead of loading Google Fonts at runtime (no third-party requests from users' browsers) or `next/font/google` (downloads at build time, so builds fail without access to Google). The cost is three small dependencies and no automatic preload of font files.

Accepted trade-offs: a code removed from the application list falls back to EUR on display until a migration cleans stored values; the interface uses one number format for everyone; currency conversion does not exist until Scenarios & FX delivers it. Tests: `tests/unit/format.test.ts`, `tests/integration/preferences.test.ts`, `tests/e2e/navigation.spec.ts`. Migration 003 is additive and safe to apply before the application change.
