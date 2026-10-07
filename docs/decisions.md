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
| Forecast money foundation uses `decimal.js` with 40 significant digits and half-even rounding | FX division needs a reviewed decimal implementation; JavaScript numbers and the dashboard's temporary scaled-integer helper are not sufficient | Extend the custom BigInt helper | New dependency; precision and rounding policy must remain explicit and tested |
| FX rates are directed (`base`/`quote`) and conversion requires a matching direct or reciprocal rate | Prevents an ambiguous number from being interpreted in the wrong direction | Infer direction or silently find a cross-rate | Callers must supply the required pair; cross-rate policy remains an open decision |
| Allocation and absolute P/L contribution (planned) | Matches the small tracker specification | Advanced risk models | Limited analytical scope |
| Server-side quote adapter | Keeps secrets private and isolates provider behavior | Direct browser requests | Server quota management and latency |

## Open decisions

- Node 24.x is selected for development, CI, and Vercel; dependencies are pinned in the lockfile.
- Compare quote providers using actual USD stock/ETF coverage, free/education quotas, freshness, symbol resolution, licensing, caching permissions, and assessment availability. Do not assume any provider offers real-time data for free.
- Define numeric precision, input bounds, quote expiry, request timeout, and refresh limits before their implementation.
- Node scrypt, `pg`, 24-hour database sessions, and per-address throttling are implemented. Recovery and email verification remain out of scope.
- Staging uses a dedicated Neon PostgreSQL host with provider authentication disabled; the application still uses direct pg/SQL and internal authentication. Vercel hosts only the application.
- Confirm available GitHub protections and hosting/database account limits.
- Confirm whether the cash-forecast feature extends this USD-portfolio product. Define cash-event timing, forecast horizon, base currency, FX observation policy, cross-rates, minimum-balance semantics, runway threshold, and scenario-contribution semantics before implementing those calculations.

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

Rounding on screen: half to even, the same rule as the forecast engine (`decimal.js` with `ROUND_HALF_EVEN`), through the `roundingMode` option of `Intl.NumberFormat`. The browser default is half away from zero, which would show 1.25 for an amount the engine rounds to 1.24. Alternative: let every caller round with the engine before formatting (rejected, one forgotten call puts two different cents on the same screen).

Currency list: EUR, USD and SGD, agreed at the team meeting on 2 October 2026, replacing the first list of EUR, USD, GBP, CHF and JPY. Three currencies keep the FX pairs and test cases small enough to verify by hand (EUR/USD, EUR/SGD and USD/SGD through the euro), and SGD carries the APAC use case in the proposal. Alternative: keep five or six currencies because ECB publishes all of them (rejected, every extra code multiplies the pairs the Forecast Engine and Scenarios & FX must test without serving the use case). Revisit only if the SGD rates cause problems.

Accepted trade-offs: a code removed from the application list falls back to EUR on display until a migration cleans stored values; the interface uses one number format for everyone; currency conversion does not exist until Scenarios & FX delivers it. Tests: `tests/unit/format.test.ts`, `tests/integration/preferences.test.ts`, `tests/e2e/navigation.spec.ts`. Migration 003 is additive and safe to apply before the application change.

## Product experience: additions beyond the agreed MVP

The agreed MVP for Product Experience was the FinTwin Global interface shell, shared formatting and the reporting currency. Three further features were added in the same pull request. Each one is in its own commit with its own tests, touches no financial calculation and no Forecast or Scenarios code, and can be reverted on its own if the team decides to keep the app smaller.

| Addition | Why it is in scope | What it costs |
| --- | --- | --- |
| Public home page (`/`) | The assessment requires a publicly reachable application. Before, the entry point redirected straight to sign-in, so a visitor could not see what the product does. The page also states which views are available and which are in development, so nothing is promised that does not exist. | One server page with no data access; signed-in users are redirected to `/dashboard`. Its copy must be kept honest as features land. |
| Active sessions and "sign out of other sessions" | US-01 already requires sessions that expire and can be revoked. This makes revocation available to the user for a shared or lost device and gives the authentication design something visible to defend. | One store module and one server action over the existing `sessions` table, using privileges the staging role already had; no new table or grant. |
| Appearance (light, dark or device) | Many people set their device to dark mode for comfort, for light sensitivity or to read at night, so a dashboard that ignores it is harder to use for them. By default the app simply follows the device; a saved choice follows the account to every browser. Turning every colour into a token for the dark palette is also what lets the automated WCAG contrast checks cover both themes. It reuses the reporting currency pattern, so it adds no new mechanism. | One additive migration (004) with a single-column grant, one action and the dark token set in `globals.css`. It is the easiest of the three to drop. |

Decision, confirmed at the team meeting on 2 October 2026: keep all three, because each supports an existing requirement (public reachability, session revocation, accessibility) rather than opening a new feature area. Dark mode in particular stays because it carries no calculation or data risk, is rendered by the server without a script, and is covered by the same contrast checks as the light theme. If scope has to shrink before submission, revert the appearance commit first, then the sessions commit; the home page should stay because it serves the public-reachability requirement.
