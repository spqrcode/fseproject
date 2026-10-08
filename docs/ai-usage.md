# AI usage record

AI-generated work must meet the same requirements as student-written work. Students remain responsible for understanding, reviewing, testing, and accepting every change.

## 2026-09-13 — Documentation baseline

- Tool: OpenAI Codex in the desktop app.
- Request: act as engineering advisor for a small, secure, tested, documented Portfolio Risk Dashboard and work incrementally.
- Context inspected: empty project directory; Git status reported that no repository exists.
- Generated work: README and eight engineering documents describing proposed scope, acceptance criteria, architecture, tests, security, delivery, and limitations.
- AI-proposed scope choices requiring team review: one portfolio per user, USD-only instruments, current positions rather than transaction history, concentration rather than historical risk models.
- Validation: document completeness and basic content checks; no executable application or automated application tests exist.
- Student review: pending. Do not describe this entry as student-approved.
- Corrections or rejected suggestions: none recorded yet. Do not invent examples to satisfy assessment requirements.

## Record each meaningful AI-assisted change

Record the date, tool/model if known, user story, important prompt or interaction summary, generated files, human reviewer, concerns raised, corrections or rejected suggestions, exact validation results, and PR/commit links.

Keep genuine examples where students identified a problem, corrected an assumption, added a missing test, or rejected an approach. Record why the original output was insufficient and how the final behavior was verified. Exclude credentials and personal data from saved prompts.

## Scope correction

The student rejected hosted backend/authentication services, including Supabase, and allowed Vercel deployment. Documentation was revised to use direct PostgreSQL access and application-managed accounts and sessions. This increases responsibility for authentication security. PostgreSQL hosting for public assessment remains unresolved. Code comments should explain useful technical details rather than include generic AI boilerplate.

## Issue 1 foundation and verification

Codex generated the authentication scaffold, PostgreSQL migration runner, tests, and CI workflow. The student instructed an audit first, then authorized Issue 1 only and staging deployment. No holdings or financial calculations were added.

Corrections: removed an unsafe global authentication lockout; isolated test databases/servers; corrected an ambiguous accessibility test locator; aligned Node 24; separated staging administrator and runtime database credentials. Verification: clean install, lint, TypeScript, build, 8 unit tests, 20 database integration tests, and 4 Chromium tests passed. See the Issue 1 evidence record for test boundaries. Student review remains pending; no student approval or collaboration history is fabricated.

## Issue 1 — AI-caused credential exposure, detected and corrected

This is the clearest example so far of AI-generated work failing review.

The agent deployed staging with `vercel deploy`, assuming `.gitignore` would keep local files out of the upload. It does not: the CLI uploads the working directory. The agent then checked the published deployment's own upload manifest and found `.local/staging.env`, `.local/staging-runtime-url`, and the local PostgreSQL data directory in the uploaded source.

What the AI got wrong: it treated `.gitignore` as a deployment boundary, and it published before verifying what had been uploaded. The verification step was correct; its ordering was not.

What was corrected: `.vercelignore` was added, the affected deployment deleted, both database passwords rotated and the old ones confirmed dead, the Vercel variable replaced, and the deployment path changed so staging is only built from Git. The final control is architectural, not a pattern file.

Evidence retained: the saved upload manifest showing the ignored paths, the later manifest showing them empty, the 404 for the deleted deployment ID, the failed authentication for the old credentials, and the smoke test against the rotated staging environment. See the security document for the full incident record.

## Haina Liu — Forecast money and FX foundation

- Date: 2026-09-29 to 2026-10-03. Tool: OpenAI Codex. Owner: Haina Liu, Forecast Engine.
- Instruction: inspect the repository first, create a separate branch, and begin the Forecast Engine foundation. The student remained responsible for reviewing, staging, committing, pushing, and opening the PR.
- Workflow: the work was developed on `haina`, reviewed by the student, pushed to `origin/haina`, and then rebased onto the updated `main`. PR #8 was approved by a teammate on 2026-10-07; resolving its merge conflicts with main remained pending.
- Generated work: strict Decimal parsing, immutable Money values, EUR/USD/SGD validation, direct and reciprocal FX conversion, explicit rounding, public exports, documentation, and focused domain tests.
- Scope deliberately deferred: cash-event projection, minimum balance, liquidity runway, Scenario contribution, and provider integration require agreed business rules or interfaces.
- Validation: On 2026-10-03, `npm ci` reported 7 vulnerabilities: one critical production vulnerability in the inherited Next.js 16.3.5 dependency and six high-severity development-tooling vulnerabilities. The focused Forecast tests passed 34 tests, and `npm run check` passed lint, TypeScript, all 100 unit tests, and the production build. `npm audit fix --force` was not used; dependency remediation is separate.

## Jiaxin Huang — Delayed-invoice scenarios

- Date: 2026-10-03 to 2026-10-08. Tools: Antigravity and OpenAI Codex. Owner: Jiaxin Huang, Scenarios and Exchange Rates.
- Instruction: implement a delayed-invoice scenario without modifying the original cash event or base forecast, keep financial calculations deterministic, use decimal strings rather than JavaScript numbers, enforce ownership in PostgreSQL, and add focused unit and integration tests.
- Student ownership: Jiaxin defined the scenario behavior and feature boundaries, coordinated the shared contracts with the Forecast Engine, Foundation and Product Experience owners, reviewed the proposed changes before delivery, and decided which work could be accepted immediately and which work had to wait for PR #10 and PR #12. She remained responsible for branch management, review decisions, commits, pushing and the Draft pull request.
- Workflow: the implementation was developed iteratively on `feat/scenario-delay-isolation`. Before finalizing the interface, Jiaxin asked Haina Liu which cash-event and Forecast Engine contracts were already included in PR #8. She then compared the scenario persistence design with Bastian's workspace schema and confirmed the Scenario Lab result requirements with Gabriel.
- AI assistance: AI tools assisted with implementation drafts, debugging, regression-test suggestions, database edge-case analysis and inspection of Git and pull-request state. The suggestions were reviewed rather than accepted automatically, and dependent Phase 2 and Phase 3 work was deliberately kept out of the Draft PR.
- Implemented work: immutable delayed-invoice adjustments, scenario persistence, ownership-scoped queries and focused unit and PostgreSQL integration tests. Applying a scenario creates a new in-memory projection; it does not update the persisted cash event or mutate the base forecast.
- Human review and corrections: Bastian reviewed PR #9 and identified issues involving the shared workspace schema, monetary precision, deletion behavior, staging database grants, PostgreSQL DATE conversion and malformed UUIDs. In response, DATE values are now read as date-only strings, UUIDs are validated before database queries, hard deletion no longer blocks account or workspace cleanup, guarded `fse_runtime` grants were added, and regression tests cover date handling, malformed identifiers and deletion cascades.
- Collaboration decisions: Haina confirmed that PR #8 supplied the Decimal, Money and FX foundations but not the cash-event or projection engine used by the first scenario prototype. Gabriel confirmed that Scenario Lab will consume decimal-string rates, source and adjusted rates, base and quote currencies, the applied percentage, effective date, provider and freshness status. Final schema and engine alignment remains dependent on PR #10 and PR #12.
- Delivery: the work is in Draft PR #9, `https://github.com/spqrcode/fseproject/pull/9`. Commit `2217b4c` contains the review corrections. Commit `4922e25` merges the latest `main`, preserves both sides of the validation contract and retargets the PR from `haina` to `main`.
- Validation: ESLint passed with zero warnings, TypeScript checking passed, 96 unit tests passed and the production build succeeded locally. GitHub Actions run `37695164245` passed migrations, lint, type checking, unit tests, PostgreSQL integration tests, the production build and Playwright end-to-end tests. The Vercel preview failure is caused by contributor-account verification on the Hobby project and is not a code or CI failure.
- Scope deliberately deferred: ECB snapshot caching and percentage-based FX shocks remain on separate local branches. Phase 3 result-contract work remains in a local stash. They are not claimed as merged, deployed or complete.
- Data handling: no real passwords, session tokens, database credentials or private financial data were supplied to an AI tool. Local environment files remain ignored and were not committed.

## Product experience increment: FinTwin Global shell, formatting and reporting currency

Date: 2026-10-01. Tool: Claude Code. Owner: Gabriel Piraccini, Product Experience.

Request: review the open pull requests, then advance the Product Experience task while the FinTwin Global domain model is still being agreed by the team. Following the team rule, the AI did not stage, commit or push: the changes were delivered as a patch for the student to inspect, test and commit.

AI-generated: the FinTwin Global branding and editorial visual design (stylesheet, self-hosted fonts, logo mark, placeholder figures), requested by the student after a first version looked like a generic AI-generated dashboard; navigation for Overview, Forecast, Scenarios, Portfolio and Settings; forecast and scenario pages with honest not-connected states; in-shell loading and error states; `PageHeading`, `EmptyState` and `Brand` components; `src/lib/format.ts` and `src/lib/currency.ts`; the reporting currency migration, store, server action, form and settings page; unit, integration and browser tests; `docs/product-experience.md` and the related documentation updates.

Problems found in the AI's own output by the tests before delivery: the first currency form used a controlled select with a comment claiming React's automatic form reset could not affect it. The browser test showed the select jumping back to EUR after USD had been saved. The select is now keyed by the saved currency and a regression assertion was added. Installing the font packages with the container's older npm rewrote unrelated `libc` entries in `package-lock.json`; the lockfile was restored and only the three font entries were added, then checked with `npm ci`. A first skip-link test assumed the focus position after a client-side redirect and failed for that reason; it now loads the page before pressing Tab.

Student review and corrections (covers this entry and the follow-up below): I asked for the work as patches so that I could apply and commit it myself, and I made the ten commits on my own machine. I rejected the first visual design because it looked like a generic AI-generated dashboard and asked for a different one. Before publishing my review of PR #6 I went through the reproduction of the staging login failure and the proposed fix. On my machine (macOS, Node 25.2) I ran npm ci, lint, typecheck, the 37 unit tests and the production build, and all of them passed. The database and browser tests did not run locally because my PostgreSQL server was not running, so for those I rely on the CI run on the pull request.

Validation (2026-10-01, cloud container with Node 22.22 and PostgreSQL 16; the project targets Node 24, so the full suite must be rerun locally): migrations applied from an empty test database and a second run applied nothing; ESLint with zero warnings and strict TypeScript clean; 35 unit tests, 36 integration tests (20 before) and 11 Chromium tests (4 before) passed; production build succeeded. The browser suite also passed with the application connected as a role holding exactly the staging privileges listed in `deployment.md`. Deliberately removing the origin check or the session expiry condition made the new integration tests fail.

Related review work: while reviewing PR #6 with AI assistance, the same staging-privilege run showed that every login fails on that branch, because the new `clearAuthAttempts` deletes from `auth_limits` and the runtime role has no `DELETE` there. This was reported in the PR review with a reproduction and a proposed fix.

## Product experience follow-ups: home page, sessions, appearance and accessibility checks

Date: 2026-10-01. Tool: Claude Code. Owner: Gabriel Piraccini, Product Experience. Same branch and delivery as the entry above: patches inspected, tested and committed by the student.

AI-generated: the public home page; the active sessions list and the action that signs out other sessions; the appearance preference (migration 004, store, action, form, dark palette); shared Playwright fixtures; `tests/e2e/accessibility.spec.ts` with `@axe-core/playwright`; the matching documentation.

Problems found in the AI's own output by the tests before delivery:
1. The appearance cards hid the real radio buttons with `pointer-events: none`, so only the label could be clicked and the browser test could not select an option. The invisible radio button now covers its whole card.
2. Keeping the current menu item visible on phones was first done with `scrollIntoView`. In Chrome that also moves the keyboard starting point onto the link, so the first Tab skipped the "Skip to content" link; the existing skip-link test caught it. The menu container is now scrolled directly, which leaves focus alone.
3. Adding `@axe-core/playwright` with the container's older npm would again have rewritten unrelated lockfile entries; only the one new entry was added and checked with `npm ci`.

The accessibility check was itself checked: making the muted text colour lighter turns both light-mode runs red with colour-contrast errors.

Validation (2026-10-01, cloud container with Node 22.22 and PostgreSQL 16; the full suite must be rerun on Node 24): four migrations applied from an empty test database and a second run applied nothing; ESLint with zero warnings and strict TypeScript clean; 37 unit tests, 51 integration tests and 22 Chromium tests passed; production build succeeded. The browser suite also passed with the application connected as a role holding exactly the staging privileges, which after migrations 003 and 004 include `UPDATE` on `users.reporting_currency` and `users.appearance` only. Deliberately removing the user predicate or the caller's expiry condition from the session-revoking query made the new integration tests fail.

## Product experience: changes requested in review and at the team meeting of 2 October

Date: 2026-10-04. Tool: Claude Code. Owner: Gabriel Piraccini, Product Experience. Same delivery as the entries above: patches inspected, tested and committed by the student.

Request: apply what Bastian asked for before merging PR #7 and what the team decided on 2 October: report only in EUR, USD and SGD; rename the sections to the agreed MVP views (Liquidity overview, Cash events, Scenario lab) and Portfolio to Workspace; write down why SGD and dark mode stay. While reviewing Haina's forecast PR (#8) the AI also noticed that the screen rounded half away from zero while the forecast engine rounds half to even, so the same amount could show a different cent.

AI-generated: the currency list change and its tests; the decisions note on the additions beyond the MVP; the renamed navigation, the forecast moved into the liquidity overview, the new cash events page and figure, the workspace page and form; half-to-even display rounding; the matching documentation.

Problems found in the AI's own output before delivery:
1. With five longer menu labels the header no longer fitted between about 760 and 1080 px wide: at 1024 px the sign-out button was pushed off the screen. This was seen on a screenshot, not by a test. The menu now moves to its own row below 1080 px, and the account email can shrink.
2. The first version of the new test for that case checked 1024 and 1100 px and still passed with the old header, so it proved nothing. It now checks 900 px, where the old header scrolls sideways, and fails without the fix.
3. After the rename, `npm run typecheck` fails on a machine that still has a `.next` folder from an earlier build, because Next.js generated types for the deleted Forecast and Portfolio pages. CI starts clean and is not affected; locally, delete `.next` before running the checks.

Student review and corrections: I checked that the four changes match Bastian's review comments and the meeting minutes of 2 October, read the diff of each patch before committing it, deleted `.next` and ran `npm run check` (lint, typecheck, unit tests and production build) on my machine. Database and browser tests run in CI on the pull request.

Validation (2026-10-04, cloud container with Node 22.22 and PostgreSQL 16): four migrations applied from an empty test database and a second run applied nothing; ESLint with zero warnings and strict TypeScript clean; 39 unit tests, 52 integration tests and 24 Chromium tests passed; production build succeeded. The browser suite also passed with the application connected as a role holding exactly the staging privileges. Each of these commits passes lint, typecheck (from a clean `.next`), unit tests and the build on its own.

## Login throttle fix and origin test coverage (branch `fix/auth-throttle`)

Date: 2026-09-29. Tool: Claude Code (Claude Sonnet 5.5). Owner: Foundation & Security student.

Problem found by the student: the throttle counted successful logins (10 correct sign-ins in 15 minutes locked the account) and shared its counter with registration, so anyone could lock a known email through the register form. The origin (CSRF) test covered only `register` and `login`.

AI-generated: the split of `allowAuthAttempt` into `authAttemptsAllowed` (read-only check), `recordFailedAuth` and `clearAuthAttempts` in `src/lib/rate-limit.ts`; `login`/`register` changes in `src/app/actions/auth.ts`; the new integration tests (12 successful logins, lockout after 10 failures and window reset, counter reset on success, registration not blocking login, origin checks for `logout` and `updatePortfolio`); the `docs/security.md` throttle section. The student specified the required behaviour and approved the plan before any code was written.

Reviewed and changed by the student: reviewed the full diff before committing. Removed an unnecessary .gitignore change (duplicate node_modules entry) and found that the browser-test cleanup still deleted the old account: throttle key; updated it to the new login:/register: keys.

PR review finding: the AI-generated `clearAuthAttempts` used `DELETE` on `auth_limits`, but the staging runtime role `fse_runtime` has only SELECT/INSERT/UPDATE there (`docs/deployment.md`), so every successful login would have failed on staging. Neither the AI output nor the student's own diff review caught it, and the integration tests could not, because they connect as the database owner. Fix: `clearAuthAttempts` now closes the window with `UPDATE auth_limits SET reset_at = now() WHERE key = $1 AND reset_at > now()` (no new privilege, no migration); the `scope` argument of `allowAuthAttempt` is now required so login cannot fall back to the increment-first path; the reset test now asserts no open window rather than no row.

AI-flagged trade-off: check-then-increment is not atomic, so parallel wrong guesses can slightly overshoot the limit. Documented in `docs/security.md`.

Validation (2026-09-29, local, Node 24, PostgreSQL 16): npm run verify passed. ESLint (zero warnings) and strict TypeScript clean; 8 unit tests, 26 integration tests (previously 20), 4 Chromium tests passed; production build succeeded; test migrations applied.

## Workspace and cash events schema (migration 005)

Date: 2026-10-07. Tool: Claude Code (Claude Sonnet 5.5). Owner: Foundation & Security student.

Task given by the student: rename `portfolios` to `workspaces`; add cash accounts and cash events with the agreed rules (EUR/USD/SGD, signed amounts, date-only, four statuses, one workspace per user); a session-scoped store; integration tests against real PostgreSQL; documentation. The student required a plan and a list of unclear points before any code, and answered six questions (narrower grants, no auto-created workspace, `expected`-only status transitions, 2000–2100 dates, a danger-threshold reader and writer, full rename scope).

AI-generated: `db/migrations/005_workspace_cash_events.sql`; `src/lib/cash-events-store.ts`; the danger-threshold functions and the rename in `src/lib/workspace-store.ts`, `src/app/actions/workspace.ts`; the cash schemas in `src/lib/validation.ts`; `src/lib/cash-event-status.ts`; `hasValidSession` in `src/lib/session-store.ts`; `tests/integration/cash-events.test.ts`; `tests/unit/cash-validation.test.ts`; the documentation changes. Not copied from PR #8 or PR #9; PR #9 was read to find conflicts.

Points the AI raised before coding: PR #9's migration 005 creates the same `cash_events` table and would collide; PR #9 reads `date` values with `toISOString()`, which can shift the day in Frankfurt; `NaN > 0` is true in PostgreSQL so `CHECK (amount > 0)` does not exclude NaN; the requested full grants were wider than the store needs, so column-level `UPDATE` was proposed; a new user has no workspace until one is named; the integration tests cannot run as the staging role without a separate owner connection for fixtures.

Found while testing: running the new tests as `fse_runtime` made one of the AI's own constraint tests fail with "permission denied", because the test tried to move an event between accounts through the runtime connection; the role correctly has no `UPDATE` on `account_id`. The test now uses the owner connection for that check.

Mutation checks: removing the session filter from the event list, the ownership join from delete, the account ownership join from event creation, or the `expected`-only status rule each made at least one new test fail.

Reviewed and changed by the student: reviewed the plan before any code was written and decided the open points (narrower column-level grants, status changes only from expected, null instead of auto-creating a workspace, a getter/setter for danger_threshold, full rename scope). Read the migration and the store queries line by line. Removed 18 iCloud duplicate files from the working tree before committing. Identified that the portfolios → workspaces rename is not backward-compatible and documented the deployment order.

Concerns for the student's review: the status order and the immutability of settled events are enforced by the application, not the database; the renamed table keeps its old portfolios_* constraint names; and the rename requires migration and deployment to happen together (see the deployment document).

Validation (2026-10-07, local, PostgreSQL 16): `npm run verify` exit code 0 — lint with zero warnings and strict TypeScript clean; 86 unit tests; migrations applied to the test database; 95 integration tests (37 of them new, in `cash-events.test.ts`); 24 Chromium tests; production build succeeded. Run as a role holding exactly the grants in `deployment.md` (migrations 003–005 plus the base grants, on a separate `_test` database): the 37 cash tests passed with the application as `fse_runtime` and fixtures as owner, and the 24 Chromium tests passed with the application server as `fse_runtime`. As that role, `UPDATE` of `cash_events.workspace_id` or `account_id`, of `cash_accounts.currency` or `workspace_id`, and `DELETE` on `cash_accounts` or `workspaces` were refused with "permission denied". Student review: pending.

Review finding (PR #10, Jiaxin, 2026-10-08): the AI-generated `updateCashEvent` and `deleteCashEvent` still allowed changing and deleting received, paid and cancelled events, although they feed the forecast's starting balance; the student's own review and the AI's earlier "concerns" note had accepted this. Fixed with `status = 'expected'` in the `WHERE` clause and `StatusConflictError` for the caller's own settled events, with new tests; `npm run verify` exit code 0 afterwards (86 unit, 99 integration, 24 Chromium tests).
