# AI usage record

AI-generated work must meet the same requirements as student-written work. Students remain responsible for understanding, reviewing, testing, and accepting every change.

## Summary

**Tools.** As recorded in the entries below: OpenAI Codex (documentation baseline, authentication scaffold, Forecast Engine, scenarios, exchange rates, Cash events and Scenario lab pages), Claude Code (Foundation & Security work, Product Experience, Liquidity overview) and Antigravity (delayed-invoice scenarios, ECB snapshot cache).

**Team rules**, as stated in this document and in the entries:
- The AI does not stage, commit or push. The student inspects the change, runs the tests and commits it.
- AI-generated work meets the same requirements and goes through the same review and CI as code written by students.
- Every meaningful AI-assisted change is recorded here, with the tool, what was generated, what was corrected and how it was verified.

| Member · Area | Where AI was used | Example correction |
| --- | --- | --- |
| Bastian · Foundation & Security | Authentication scaffold, migration runner and CI (Codex, [foundation](#issue-1-foundation-and-verification)); [login throttle](#login-throttle-fix-and-origin-test-coverage-branch-fixauth-throttle), [workspace and cash-event schema](#workspace-and-cash-events-schema-migration-005) and stores, [forecast input](#forecast-input-starting-balance-overdue-events-status-mapping-branch-featforecast-input) (Claude Code) | The agent deployed staging with `vercel deploy` and uploaded files that Git ignores; found in the upload manifest, passwords rotated, deployments moved to Git-only builds ([credential exposure](#issue-1--ai-caused-credential-exposure-detected-and-corrected)) |
| Haina Liu · Forecast Engine | [money and FX foundation](#haina-liu--forecast-money-and-fx-foundation), [cash projection](#haina-liu--cash-projection-and-review-follow-up) and [PR #12 corrections](#haina-liu--pr-12-review-corrections) (Codex) | A first revision made the engine use the database statuses directly; rejected because the team decision gives the adapter that mapping ([PR #12 corrections](#haina-liu--pr-12-review-corrections)) |
| Jiaxin Huang · Scenarios & Exchange Rates | [delayed-invoice scenarios](#jiaxin-huang--delayed-invoice-scenarios) (Antigravity, Codex); [ECB snapshot cache](#jiaxin--ecb-snapshot-cache-and-failure-handling-migration-006), [FX shocks](#jiaxin-huang--percentage-based-fx-shocks), [Cash events page](#cash-events-product-integration) and [Scenario lab page](#jiaxin--scenario-lab-product-integration) (Codex); [Liquidity overview](#jiaxin-covering-product-experience--liquidity-overview-connected-to-the-forecast-branch-featproduct-liquidity-overview) (Claude Code) | The first ECB snapshot draft updated a stored rate in place when ECB republished it, which would silently change reproducible scenarios; changed so a corrected rate is a new immutable snapshot ([ECB snapshot cache](#jiaxin--ecb-snapshot-cache-and-failure-handling-migration-006)) |
| Gabriel Piraccini · Product Experience | [interface shell, formatting and reporting currency](#product-experience-increment-fintwin-global-shell-formatting-and-reporting-currency), [home page, sessions, appearance and accessibility checks](#product-experience-follow-ups-home-page-sessions-appearance-and-accessibility-checks) and [exchange-rate display](#product-experience-exchange-rate-display) (Claude Code) | The first currency form made the select jump back to EUR after saving USD; the browser test caught it and the select is now keyed by the saved currency ([interface shell, formatting and reporting currency](#product-experience-increment-fintwin-global-shell-formatting-and-reporting-currency)) |

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
- Collaboration decisions: Haina confirmed that PR #8 supplied the Decimal, Money and FX foundations but not the cash-event or projection engine used by the first scenario prototype. Gabriel confirmed that Scenario Lab will consume decimal-string rates, source and adjusted rates, base and quote currencies, the applied percentage, effective date, provider and freshness status. The scenario schema is now aligned with the merged PR #10; final engine alignment remains dependent on PR #12.
- Delivery: the work is in Draft PR #9, `https://github.com/spqrcode/fseproject/pull/9`. Commit `2217b4c` contains the review corrections. Commit `4922e25` merges the latest `main`, preserves both sides of the validation contract and retargets the PR from `haina` to `main`.
- Validation: ESLint passed with zero warnings, TypeScript checking passed, 96 unit tests passed and the production build succeeded locally. GitHub Actions run `37695164245` passed migrations, lint, type checking, unit tests, PostgreSQL integration tests, the production build and Playwright end-to-end tests. The Vercel preview failure is caused by contributor-account verification on the Hobby project and is not a code or CI failure.
- Scope deliberately deferred: ECB snapshot caching and percentage-based FX shocks remain on separate local branches. Phase 3 result-contract work remains in a local stash. They are not claimed as merged, deployed or complete.
- Data handling: no real passwords, session tokens, database credentials or private financial data were supplied to an AI tool. Local environment files remain ignored and were not committed.
- Post-review alignment on 2026-10-08: after Jiaxin reviewed and approved Bastian's PR #10, its workspace/account/event schema was merged into `main`. The duplicate cash-event migration and store were removed from this Draft; scenario persistence now uses migration 007, the canonical cash-event store and workspace-safe composite foreign keys. Jiaxin retained migration 006 for the separate ECB snapshot work and kept the Forecast Engine adapter deferred until PR #12 is finalized. Final local checks covered 143 unit tests, 115 PostgreSQL integration tests and 24 Chromium tests. A separate fresh database containing the staging role confirmed that it can select and insert scenario data and update only adjustment status metadata, but cannot delete scenario rows or rewrite their ownership columns.
- Follow-up on 2026-10-12: after PR #12 was merged, OpenAI Codex resolved PR #9's conflicts by retaining Haina's canonical cash-event and forecast-engine files and adapting only Jiaxin's scenario module and tests. The old scenario tests had assumed event-only timeline points and ignored overdue events; they now assert the engine's daily timeline and overdue-on-start rule. This follow-up remains subject to Jiaxin's review before merge.

## Jiaxin Huang — Percentage-based FX shocks

- Date: 2026-10-10 to 2026-10-12. Tool: OpenAI Codex. Owner: Jiaxin Huang, Scenarios & Exchange Rates.
- Student decisions: Jiaxin set the ownership boundary: the FX service resolves direct, reciprocal and cross rates, while the Forecast Engine receives resolved rates and remains deterministic. Jiaxin also confirmed that `-10` means minus 10%, unavailable results contain no fallback rate, and Scenario Lab receives freshness and snapshot metadata with the adjusted result.
- AI assistance: inspected and adapted the Phase 3 work to the merged forecast and scenario contracts, including test events with canonical timestamps and statuses. This work remains subject to Jiaxin's review before GitHub delivery or merge.
- Validation: focused unit tests and PostgreSQL integration tests passed after the 2026-10-12 alignment; the full-suite result is recorded separately once complete. No staging or production deployment is claimed.

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

Date: 2026-09-29. Tool: Claude Code (Claude Sonnet 5.5). Owner: Bastian

Problem found by the student: the throttle counted successful logins (10 correct sign-ins in 15 minutes locked the account) and shared its counter with registration, so anyone could lock a known email through the register form. The origin (CSRF) test covered only `register` and `login`.

AI-generated: the split of `allowAuthAttempt` into `authAttemptsAllowed` (read-only check), `recordFailedAuth` and `clearAuthAttempts` in `src/lib/rate-limit.ts`; `login`/`register` changes in `src/app/actions/auth.ts`; the new integration tests (12 successful logins, lockout after 10 failures and window reset, counter reset on success, registration not blocking login, origin checks for `logout` and `updatePortfolio`); the `docs/security.md` throttle section. The student specified the required behaviour and approved the plan before any code was written.

Reviewed and changed by the student: reviewed the full diff before committing. Removed an unnecessary .gitignore change (duplicate node_modules entry) and found that the browser-test cleanup still deleted the old account: throttle key; updated it to the new login:/register: keys.

PR review finding: the AI-generated `clearAuthAttempts` used `DELETE` on `auth_limits`, but the staging runtime role `fse_runtime` has only SELECT/INSERT/UPDATE there (`docs/deployment.md`), so every successful login would have failed on staging. Neither the AI output nor the student's own diff review caught it, and the integration tests could not, because they connect as the database owner. Fix: `clearAuthAttempts` now closes the window with `UPDATE auth_limits SET reset_at = now() WHERE key = $1 AND reset_at > now()` (no new privilege, no migration); the `scope` argument of `allowAuthAttempt` is now required so login cannot fall back to the increment-first path; the reset test now asserts no open window rather than no row.

AI-flagged trade-off: check-then-increment is not atomic, so parallel wrong guesses can slightly overshoot the limit. Documented in `docs/security.md`.

Validation (2026-09-29, local, Node 24, PostgreSQL 16): npm run verify passed. ESLint (zero warnings) and strict TypeScript clean; 8 unit tests, 26 integration tests (previously 20), 4 Chromium tests passed; production build succeeded; test migrations applied.

## Haina Liu — Cash projection and review follow-up

- Date: 2026-10-07. Tool: OpenAI Codex. Owner: Haina Liu, Forecast Engine.
- Request: implement and review deterministic cash-event projection, minimum balance, liquidity runway and agreed forecast rules.
- AI-assisted work: proposed code, tests and documentation for the fixed 50% warning threshold, deterministic same-day ordering, shared reporting-currency allowlist and negative half-even rounding cases.
- Student review: inspected the diff, confirmed the business rules, ran the tests and created the commits personally.
- Validation: 90 Forecast domain tests and 129 total unit tests passed; ESLint, TypeScript typecheck and the Next.js production build passed.
- Remaining team decision: confirm EUR-derived cross-rate ownership and precision with the ECB adapter owner.

## Workspace and cash events schema (migration 005)

Date: 2026-10-07. Tool: Claude Code (Claude Sonnet 5.5). Owner: Bastian

Task given by the student: rename `portfolios` to `workspaces`; add cash accounts and cash events with the agreed rules (EUR/USD/SGD, signed amounts, date-only, four statuses, one workspace per user); a session-scoped store; integration tests against real PostgreSQL; documentation. The student required a plan and a list of unclear points before any code, and answered six questions (narrower grants, no auto-created workspace, `expected`-only status transitions, 2000–2100 dates, a danger-threshold reader and writer, full rename scope).

AI-generated: `db/migrations/005_workspace_cash_events.sql`; `src/lib/cash-events-store.ts`; the danger-threshold functions and the rename in `src/lib/workspace-store.ts`, `src/app/actions/workspace.ts`; the cash schemas in `src/lib/validation.ts`; `src/lib/cash-event-status.ts`; `hasValidSession` in `src/lib/session-store.ts`; `tests/integration/cash-events.test.ts`; `tests/unit/cash-validation.test.ts`; the documentation changes. Not copied from PR #8 or PR #9; PR #9 was read to find conflicts.

Points the AI raised before coding: PR #9's migration 005 creates the same `cash_events` table and would collide; PR #9 reads `date` values with `toISOString()`, which can shift the day in Frankfurt; `NaN > 0` is true in PostgreSQL so `CHECK (amount > 0)` does not exclude NaN; the requested full grants were wider than the store needs, so column-level `UPDATE` was proposed; a new user has no workspace until one is named; the integration tests cannot run as the staging role without a separate owner connection for fixtures.

Found while testing: running the new tests as `fse_runtime` made one of the AI's own constraint tests fail with "permission denied", because the test tried to move an event between accounts through the runtime connection; the role correctly has no `UPDATE` on `account_id`. The test now uses the owner connection for that check.

Mutation checks: removing the session filter from the event list, the ownership join from delete, the account ownership join from event creation, or the `expected`-only status rule each made at least one new test fail.

Reviewed and changed by the student: reviewed the plan before any code was written and decided the open points (narrower column-level grants, status changes only from expected, null instead of auto-creating a workspace, a getter/setter for danger_threshold, full rename scope). Read the migration and the store queries line by line. Removed 18 iCloud duplicate files from the working tree before committing. Identified that the portfolios → workspaces rename is not backward-compatible and documented the deployment order.

Concerns for the student's review: the status order and the immutability of settled events are enforced by the application, not the database; the renamed table keeps its old portfolios_* constraint names; and the rename requires migration and deployment to happen together (see the deployment document).

Validation (2026-10-07, local, PostgreSQL 16): `npm run verify` exit code 0 — lint with zero warnings and strict TypeScript clean; 86 unit tests; migrations applied to the test database; 95 integration tests (37 of them new, in `cash-events.test.ts`); 24 Chromium tests; production build succeeded. Run as a role holding exactly the grants in `deployment.md` (migrations 003–005 plus the base grants, on a separate `_test` database): the 37 cash tests passed with the application as `fse_runtime` and fixtures as owner, and the 24 Chromium tests passed with the application server as `fse_runtime`. As that role, `UPDATE` of `cash_events.workspace_id` or `account_id`, of `cash_accounts.currency` or `workspace_id`, and `DELETE` on `cash_accounts` or `workspaces` were refused with "permission denied". Student review: done, see above.

Review finding (PR #10, Jiaxin, 2026-10-08): the AI-generated `updateCashEvent` and `deleteCashEvent` still allowed changing and deleting received, paid and cancelled events, although they feed the forecast's starting balance; the student's own review and the AI's earlier "concerns" note had accepted this. Fixed with `status = 'expected'` in the `WHERE` clause and `StatusConflictError` for the caller's own settled events, with new tests; `npm run verify` exit code 0 afterwards (86 unit, 99 integration, 24 Chromium tests).

## Cash events product integration

Date: 2026-10-11. Tool: OpenAI Codex. Owner: Jiaxin.

Jiaxin decided to take over the unimplemented Cash events user flow after reviewing the Product Experience workload. She set the scope boundary: connect the already-merged session-scoped stores without duplicating forecast or scenario calculations, keep the work on a separate branch, preserve the existing visual system, and verify the complete browser path before committing.

Codex assisted with the server actions, account and event forms, persisted event schedule, responsive styling, overview status, documentation and browser tests. During browser verification, Jiaxin retained the existing financial rules from PR #10: signed decimal strings, account-owned currency, `expected`-only edits, and final settled events. The tests exposed two presentation issues before delivery: success feedback was hidden or lost after server revalidation, and an invalid amount reset the other form values. The implementation was changed to use redirect-backed success messages and controlled inputs that survive validation errors.

Verification used a local PostgreSQL 16 container bound only to localhost with the dedicated `portfolio_risk_test` database. No staging or production data was used. Final validation evidence is recorded in `docs/testing.md`; staging deployment and PR publication remain separate student decisions.

## Jiaxin — ECB snapshot cache and failure handling (migration 006)

Date: 2026-10-08 to 2026-10-09. Tools: Antigravity and OpenAI Codex. Owner: Jiaxin (Scenarios & Exchange Rates).

Student direction and review: Jiaxin split the work into separate scenario, ECB-cache and FX-shock phases; confirmed the contract with Haina, Bastian and Gabriel; chose decimal strings, explicit `CURRENT`/`STALE`/`UNAVAILABLE` states and `null` for an unavailable rate; kept the provider layer independent of the deterministic shock calculation; and asked for a clean branch based on main after discovering that the first local branch also contained unrelated forecast and scenario commits. Jiaxin reviewed the proposed API and database behavior before the final PR and remains responsible for accepting the diff.

AI-assisted implementation and debugging: generated the initial migration, ECB parser/provider, snapshot store, rate service and focused tests; then audited them against the official ECB API and the merged workspace schema. The audit added narrow `fse_runtime` grants, strict real-date and database-precision checks, atomic persistence of both ECB legs, protection against an older response overwriting a newer fetch, normalized decimal strings, typed failure metadata, and a same-effective-date requirement for cross-rates. It also added PostgreSQL integration tests using a separate owner connection for fixtures while the application runs with the restricted runtime role.

Corrections to the initial AI-assisted version: it had no runtime grants, accepted impossible calendar dates, recorded fetch time before the response body completed, persisted the two rates separately, could combine different effective dates into one cross-rate, and returned too little information for the Scenario Lab to distinguish stale from unavailable data. These issues were found during review and corrected before the PR. A live smoke request to the official ECB endpoint returned the expected CSV columns and both USD and SGD observations; deterministic automated tests still mock the provider so CI does not depend on the network.

Review correction (PR #13, Bastian, 2026-10-10): the first draft updated `rate` in place when ECB republished the same pair and effective date. Because a scenario will retain `snapshotId`, that would silently change a previously reproducible result. The schema now treats provider/pair/date/rate as one observation: an identical repeat updates only `fetched_at`, while a corrected rate creates a new immutable id. The runtime role can no longer update `rate`. The same review led to fixed UI-safe failure messages with raw details only in server logs, a real `server-only` boundary in the provider, a 64 KiB response cap, and effective-date-first stale ordering. The requested parallel-refresh lock remains documented follow-up work rather than expanding this PR.

Validation (2026-10-10, local, Node 24.14.0 and PostgreSQL 16): `npm run verify` exited 0 — ESLint with zero warnings, strict TypeScript, 162 unit tests, production build, 111 integration tests and 24 Chromium tests passed. Migrations 001–006 were applied successfully from an empty database. The 12 FX integration tests passed with the application connected as `fse_runtime` and fixtures connected as the database owner; direct privilege checks returned SELECT=true, INSERT=true, DELETE=false, UPDATE `fetched_at`=true, UPDATE `rate`=false and UPDATE `provider`=false. Phase 3 percentage-shock work and Scenario Lab UI are deliberately not part of this increment.

## Haina Liu — PR #12 review corrections

- Date: 2026-10-11. Tool: OpenAI Codex. Owner: Haina Liu, Forecast Engine.
- Request: address the changes requested on PR #12 and align the Forecast Engine with migration 005 and the forecast-input boundary.
- AI-assisted work: added a 366-day maximum horizon, canonical UTC timestamp precision, consistent `ForecastInputError` handling, overdue-event handling, nullable workspace-threshold support, negative opening-balance handling, documentation and regression tests.
- Review correction: the first revision changed the Forecast Engine to use the database statuses directly. After merging the latest `main`, the existing team decision showed that PR #14 owns the adapter mapping from `expected / received / paid / cancelled` to the engine's `pending / completed / cancelled` contract. The direct-status change was therefore rejected and corrected.
- Student action: reviewed the PR comments, resolved the AI-usage merge conflict by retaining both records, selected the business rules and ran the complete local validation.
- Validation: 100 Forecast domain tests and 186 total unit tests passed; ESLint, TypeScript typecheck and the Next.js production build passed.

## Jiaxin — Scenario lab product integration

Date: 2026-10-12. Tool: OpenAI Codex. Owner: Jiaxin (Scenarios & Exchange Rates).

Jiaxin authorized taking on the unfinished Scenario lab page and set the contract boundary: use the existing session-scoped scenario and ECB services, keep cash events and snapshots unchanged, and do not show invented forecast balances while the shared forecast-input adapter is under review. Codex assisted with the server actions, forms, page layout, styling, browser test and documentation. The implementation exposes original and delayed invoice dates, a percentage-shock preview with ECB provenance and freshness, and saving only for direct EUR pairs backed by one snapshot. The first browser run exposed a currency-label mismatch and a missing wait for workspace creation; a later run found an ambiguous `alert` test locator. These were corrected and all 27 Chromium tests passed. The student will inspect the diff, review the PR and own the final merge decision. Numerical base-versus-scenario forecasts remain for a later integration.

Review follow-up (Bastian, 2026-10-12): Jiaxin accepted that saved shocks must stay tied to their original immutable ECB snapshot. Bastian asked for the snapshot's ECB date and a hint when a newer cached rate exists. The date and source rate were already displayed; Codex added a read-only latest-snapshot comparison and the hint. Tests cover a repeat fetch, another pair, a later ECB date and a correction to the same ECB date, while verifying the saved calculation still uses its original rate.

## Scenario adjustments that no longer apply (PR #9 review, Bastian, 2026-10-12)

Review correction: the first AI-assisted version of the scenario calculation deliberately threw `InvalidAdjustmentError` or `MissingEventError` "rather than silently ignoring the override", and its tests asserted the throw. Bastian pointed out that this breaks a whole scenario whenever an adjusted event is later received, paid or cancelled (his forecast input returns only expected events), and whenever an adjustment targets an event on another account (scenarios are per workspace, forecasts per account). The decision was wrong, not a bug in its implementation, and neither the AI nor the first review had tried it with data that changes after the adjustment.

Change: adjustments that cannot apply are skipped and returned with a reason, `getAdjustments` derives `not_applicable` without writing, and `applyDelayAdjustment` stays strict. The old "throws" assertions for `runScenarioForecast` were replaced, not deleted: they now assert the skip and its reason, and two integration tests cover settle-after-delay and the two-account case. Validation (2026-10-12, local, PostgreSQL 16): lint and TypeScript clean, 256 unit tests, 129 integration tests, production build.

## Forecast input: starting balance, overdue events, status mapping (branch `feat/forecast-input`)

Date: 2026-10-10. Tool: Claude Code (Claude Sonnet 5.5). Owner: Foundation & Security student.

Task given by the student: one server-only function that loads, for one account, everything the forecast engine needs, resolved by the team's decisions of 2026-10-08, plus a pure status mapping; no call into the engine yet. The student required a plan and open questions first, approved the plan, and answered the one open question.

The open question and its resolution: the AI pointed out that a `received` or `paid` event dated on or after the start date would be in neither the starting balance nor the event list, and proposed counting all settled events in the balance. The student's team kept the original rule and closed the gap at the source instead: marking an event `received` or `paid` moves a future date to today (UTC, not `current_date`, which depends on the session time zone). The AI's proposal was not used.

AI-generated: `src/lib/forecast-input-store.ts`, `src/lib/forecast-input.ts`, `forecastRangeSchema` in `src/lib/validation.ts`, the date rule in `setCashEventStatus`, `notFound` exported from `src/lib/cash-events-store.ts` (renamed from a private helper), `tests/integration/forecast-input.test.ts`, `tests/unit/forecast-input.test.ts`, new settling tests in `tests/integration/cash-events.test.ts`, and the documentation changes. Nothing was imported from PR #12; its `forecast-engine.ts` and `cash-event.ts` were read for orientation, which produced three recorded integration points (threshold input, negative opening balance, `userId` and per-event currency).

Found while testing: a first draft of the early-settlement test would have passed for the wrong reason; the final test creates the event in the future, shows it in the event list before settling, and shows it in the starting balance and gone from the list afterwards. Five deliberate breaks of the code (date rule off, `<=` instead of `<` in the balance, the event list not limited to `expected`, the session condition dropped from the account query, overdue events not moved) each made at least one test fail.

Reviewed and changed by the student: reviewed the plan before any code was written and decided the open points: one read-only REPEATABLE READ snapshot with the connection released in finally, validation before the session check, createdAt as UTC text. Rejected the AI’s proposal for the open question (count all settled events in the starting balance); after discussing it with the team, decision 3 was kept and the gap closed at the source by moving a future date to today on settling, with an explicit UTC date instead of current_date. Asked for a test showing an early-settled event moving into the starting balance, and for the three PR #12 mismatches to be documented as open integration points. Re-ran the integration tests after a single unexplained timeout (238 s in an unchanged cash-events test); the following runs passed (126/126, about 11.5 s each).

Concerns for the student’s review: an early-settled event loses its planned date, since only the date the money moved is kept (accepted and documented in limitations.md); both queries repeat the ownership joins on purpose rather than trusting ids from the first query; the 366-day limit is enforced here and should also be enforced by the engine (PR #12); the one-off test timeout could not be reproduced or explained; decision 2 (threshold default) still depends on PR #12.

Validation (2026-10-10, local, PostgreSQL 16): `npm run verify` exit code 0 — lint with zero warnings and strict TypeScript clean; 124 unit tests; test migrations applied; 126 integration tests (the new forecast-input file and the settling tests included); production build succeeded; 24 Chromium tests. The cash-events and forecast-input integration files also passed (68 tests) with the application connected as a role holding exactly the grants in `deployment.md`; no new grants were needed, since the forecast input only reads. Student review: done, see above.

Review finding (PR #14, Haina, 2026-10-11): two defects in the AI-generated forecast input, both missed by the AI and by the student's review. (1) The starting balance counted settled events dated before the start date, so money that moved on the start day, including an event marked paid today in a forecast that starts today, was in neither the balance nor the list; fixed by counting `<=` the start date (overdue stays `<`) with two new integration tests and an updated starting-balance test. (2) The 366-day limit counted differences instead of dates, so it allowed 367 dates while the engine in PR #12 allows 366; fixed by counting both ends, with the boundary tests moved to 2026-10-01 to 2027-10-01 (accepted) and 2027-10-02 (rejected). Validation after the fix (2026-10-11, local, PostgreSQL 16): `npm run verify` exit code 0 — 124 unit, 128 integration and 24 Chromium tests; lint and TypeScript clean; production build succeeded. Student review: read the diff line by line and confirmed that only the starting-balance condition changed to `<=` while the overdue condition stays `<`.

## Jiaxin (covering Product Experience) — Liquidity overview connected to the forecast (branch `feat/product-liquidity-overview`)

Date: 2026-10-12. Tool: Claude Code. Owner: Jiaxin, covering Gabriel's Product Experience work.

Student direction: connect the overview only to real data — the store of PR #14, the adapter of PR #19 and the engine of PR #12 — without editing those branches, and show nothing estimated. Keep amounts in the account's currency with a visible notice until FX conversion exists. While reviewing PR #19 the student and AI found that the workspace danger threshold (reporting currency) is applied unconverted to accounts in other currencies; the overview now states this and it is recorded in `limitations.md`.

AI-generated: `src/lib/liquidity-overview.ts` (horizon, UTC window, chart geometry), `src/lib/liquidity-forecast.ts`, `src/components/liquidity-chart.tsx`, the overview page, `formatDate`, the forecast styles, and the unit, integration and Chromium tests. Corrections during development: the engine's minimum can be the balance before the start date's events and so lie below every end-of-day point, so the chart marker uses the engine's minimum rather than a timeline point; two existing browser assertions were updated only where the page's behaviour intentionally changed (the overview no longer shows "not connected"), and the reporting-currency sentence was kept so the original assertion still holds.

Validation (2026-10-12, local, PostgreSQL 16): `npm run verify` exit code 0 — lint and TypeScript clean; 250 unit tests; 144 integration tests; production build; 30 Chromium tests, including WCAG 2.2 AA checks of the forecast view (with a breach, overdue events and the daily table open) in light and dark mode, and a 375 px phone width.

Merge with `main` (2026-10-12, after PRs #12, #13 and #19): Claude Code resolved the conflicts in four documentation files by keeping both sides; the student compared the result line by line with `main` (no line from `main` lost except text that this branch deliberately updates) and with Gabriel's resolution on `feat/product-liquidity-overview`, and updated the 2026-10-10 decision entry now that the engine and `toForecastInput` are merged. AI-generated: one integration test that runs `getForecastInput` → `toForecastInput` → `runForecast` for an account with a settled, an overdue and a future event. Validation: CI on the merge commit 6c7bf18 passed: 238 unit, 141 integration and 24 Chromium tests, lint, typecheck and build.

## FX shock bounds and errors (PR #17 review, Bastian, 2026-10-12)

Review correction: the first AI-assisted FX-shock code validated only "greater than -100" in two places (a private parser and the store) and left the column an unbounded `numeric`. Bastian found that +5000% or a 40-digit value was accepted. Neither the AI nor the first human review had tried the upper end, and the duplicated parser had already drifted from the one in `calculateShockedRate`. Change: one exported `parseShockPercent` (-99.99 to 100, four decimals) used by the preview and the save, migration 009 for the column and a range check, a domain error for a duplicate shock, and "Authentication required." for an expired session. One existing unit test relied on an 18-decimal input and was rewritten to test what it meant to (the shocked rate is not rounded) with a four-decimal input; one integration assertion now expects the column's four decimals. Validation (2026-10-12, local, PostgreSQL 16): lint and TypeScript clean, unit tests, 169 integration tests, production build.

## Base versus scenario comparison (branch `feat/scenario-comparison`)

Date: 2026-10-12. Tool: Claude Code. Owner: Jiaxin (Scenarios & Exchange Rates), covering the Scenario lab for Product Experience.

Student direction: build the side-by-side view on the merged forecast input, adapter and scenario calculation, make the breakdown add up to the difference by construction and not by rounding, and show what was not applied instead of hiding it (a consequence of Bastian's review of #9).

AI-generated: `compareScenario`, the server composition, the comparison panel, and the unit, integration and browser tests. Design check by the student: the closing balance is the opening balance plus the events dated inside the range, so it is additive across events and one adjustment per event makes the per-adjustment effects sum exactly to the total; the function checks the equality and throws instead of showing a breakdown that does not add up. Found while testing: a first browser test used the wrong locator once an event existed (two Description fields); a final assertion assumed the Cash events date format from another branch and was made independent of it.

Validation (2026-10-12, local, PostgreSQL 16): `npm run verify` exit code 0 — lint and TypeScript clean, 318 unit tests, 173 integration tests, production build, 32 Chromium tests including WCAG 2.2 AA checks of the comparison in light and dark mode at 375 px.

Follow-up merge (2026-10-12): Codex incorporated the latest Scenario Lab branch after its saved-ECB-snapshot review change. The comparison code and tests remain in this branch; the merged page now refreshes the FX preview before reading saved shocks and then computes the account comparison. Local `npm run verify` passed with 318 unit, 190 PostgreSQL integration and 36 Chromium tests, plus lint, typecheck and production build, against a fresh dedicated test database.

## Product experience: exchange-rate display

Date: 2026-10-12. Tool: Claude Code. Owner: Gabriel (Product Experience). Delivered as a patch that the student inspected, tested and committed.

Request: while reviewing PR #18 the student ran the Scenario lab with seeded ECB snapshots and saw cross and reciprocal rates printed with about 40 digits ("1 USD = 1.30130803242446573323507737656595431098 SGD"). AI-generated: `formatRate` in `src/lib/format.ts`, its unit tests and the presentation rule in `docs/product-experience.md`. Rates are shown with four decimals, half to even like amounts; the calculation keeps every digit and pages keep the exact value next to the text.

Validation: ESLint and TypeScript clean, all unit tests passed including the new ones, production build passed. Removing the half-even rounding mode makes the rounding test fail (1.23445 becomes 1.2345).

## CI runs the data-store tests as the restricted staging role (branch `chore/ci-runtime-role`)

Date: 2026-10-12. Tool: Claude Code (Claude Sonnet 5.5). Owner: Foundation & Security student.

Task given by the student: make CI fail on a missing or too-broad grant by running the data-store integration tests with the application connected as `fse_runtime`, as the student had done by hand for earlier PRs; separate role-setup script, a separate test mode instead of changing the existing one, no weakened guards, and a mutation check.

AI-generated: `scripts/ci-runtime-role.mjs`, the `integration:runtime` mode in `scripts/test.mjs`, the `test:integration:runtime` npm script, the new steps in `.github/workflows/ci.yml`, and the documentation changes. Design points the AI raised: the role must exist before the migrations (their guarded `GRANT` blocks) but the base grants can only be given after them, so the script has two steps; the files for the runtime step are found by whether they read `TEST_FIXTURES_DATABASE_URL`, so a new test opts in by using the same pattern; the runtime URL must be a different user on the same server and database as the owner URL, otherwise the step would silently test nothing.

Which files run as the role and which cannot: `cash-events`, `forecast-input`, `fx` and `liquidity-forecast` are written for it. `ownership`, `preferences`, `sessions`, `cash-event-actions`, `scenario` and `fx-shock` use one connection for application code and fixtures and require `DATABASE_URL` to equal `TEST_DATABASE_URL`; their fixtures need `DELETE` on `users`, `UPDATE` on `sessions` or `DELETE` on `fx_snapshots`. Their guards and assertions were not changed.

Mutation checks (temporary, restored, on fresh scratch databases). First version, tests of the stores only: removing `status` from the `UPDATE` grant on `cash_events` in migration 005 passed the owner step and failed the runtime step (16 tests in 2 files); adding `DELETE` on `fx_snapshots` to migration 006 passed both steps, because no test asserted the refusal. The student asked for the privilege check that closes this gap, and the AI added `tests/integration/runtime-privileges.test.ts`: an explicit expected map per table and column compared for equality with `has_table_privilege` and `has_column_privilege`, plus checks of the role's attributes. Repeated afterwards: the missing `status` grant now also fails the privilege test (17 failures in 3 files in the runtime step); the extra `DELETE` on `fx_snapshots` fails exactly one test, "holds exactly the documented privileges on fx_snapshots"; an extra `DELETE` on `workspaces` and `auth_limits` in the base grants of `scripts/ci-runtime-role.mjs` fails two. The privilege test first ran in both steps; after the student found that this made `npm run verify` fail on a local database that was not in CI state (a stray table from another branch and grants missing because the role was created after the migrations), it was limited to the runtime step and is skipped with a message in the plain integration run. In the runtime step a missing role skips the file locally and fails it when `CI` is set; the missing-role paths were run against a copy of the test with a role name that does not exist.

Found while writing it: the default reporter hides `console.warn` output, so the first version of the skip message was never shown; it is now written to stderr from inside a skipped test.

Reviewed and changed by the student: I set the goal, because the missing DELETE privilege in PR #6 had only been found by running tests as the role by hand. I asked for a mutation check as proof. After the first version missed an extra grant (DELETE on fx_snapshots), I decided to add a test that compares the role's actual privileges with the documented list. When that test broke `npm run verify` on my stale local test database, I decided it runs only in the runtime step, where CI enforces it. I read the diff, checked the expected map against `deployment.md`, and rebuilt my local test database in CI state.

Concerns for the student's review: the grant list now exists in three places (`deployment.md`, the CI script and the test's expected map), which have to be changed together by hand. The scenario, FX-shock and cash-event-action tests still run only as the owner, because their fixtures need rights the role does not have; their tables are covered only by the privilege test. The test reads the catalog, so privileges inherited through role memberships are not compared, which is why it forbids memberships separately. The CI password is a throwaway value for the CI service only.

Validation (2026-10-12, local, rebuilt `portfolio_risk_test` in CI state): `npm run verify` exit 0: 315 unit, 187 integration (1 skipped, the privilege test), 36 Chromium; lint, typecheck and build clean. `npm run test:integration:runtime` exit 0: 101 passed in 5 files, including 14 privilege tests. Mutations: missing UPDATE (status) on cash_events → 17 failed; extra DELETE on fx_snapshots → privilege test failed; extra DELETE in the base grants → 2 failed.

## Submission cleanup (branch `chore/submission-cleanup`)

Date: 2026-10-13. Tool: Claude Code (Claude Sonnet 5.5). Owner: Bastian

Task given by the student: prepare the repository for the professor's access without touching `README.md` or `docs/limitations.md` (both are being rewritten in PR #21). The AI did not stage, commit or push.

AI-generated: the `.gitignore` guard against macOS and iCloud duplicate files; workspace wording on the sign-in and registration pages; the rewrite of `docs/requirements.md` (US-02 as the workspace story, US-03 to US-06 replaced by a paragraph "Earlier scope (replaced)", US-07 for the current data, the engineering acceptance criteria and the traceability table); the package rename to `fintwin-global`; the removal of `toEngineStatus` and its unit test, because `toForecastInput` already marks every stored expected event pending; the decision sentence that named it; the summary at the top of this document. Before the rewrite the AI listed every reference to US-02 to US-07 (only `docs/requirements.md` referred to them).

Headings and owner lines of two entries of Haina Liu were renamed from "Member B" to her name and role. The rename was agreed with her; nothing else in her entries was changed, and no other member's entry was edited. The summary table was written only from what the entries already say.

Not renamed on purpose: the session cookie `portfolio_session` (renaming it would sign every user out) and the pool variable in `src/lib/db.ts`.

Reviewed and changed by the student: I set the scope of the cleanup and left README.md and docs/limitations.md out because Jiaxin’s PR #21 rewrites them. I checked the rewritten user stories and traceability rows against the current code. I agreed the “Member B” → Haina Liu rename with Haina. I kept the portfolio_session cookie name on purpose, because renaming it would sign out every existing session.

Validation: npm run verify passed locally on this branch: 313 unit, 196 integration and 39 Chromium tests, lint, typecheck and build. A search for @/lib/forecast-input found no remaining imports.

## Comparison in the reporting currency (branch `feat/comparison-reporting-currency`)

Date: 2026-10-13. Tool: Claude Code. Owner: Jiaxin. Follow-up requested by Haina in her approval of #23.

Found before writing the change: a probe with converted inputs showed that the exact sum check in `compareScenario` throws for real rates such as EUR/SGD 1.4127, because converted amounts carry 40 significant digits and sums round in the last digit. Connecting the comparison to the conversion as it was would have broken the Scenario lab for every Singapore-dollar account. The student chose a documented tolerance (10⁻¹⁰) over rounding converted amounts, to keep #26's rule that amounts are rounded only for display.

AI-generated: the tolerance and `contributionsAddUp`, the comparison through `forecastStoredInReportingCurrency`, the shared `ConversionNote` and `NoRateNotice` (now used by both pages), and the unit and PostgreSQL tests. The overview's notes keep their exact wording, which its browser tests check.

Validation (2026-10-13, local, fresh PostgreSQL 16 database): see the PR description for the numbers of the final run.

## Haina Liu — Forecast Engine status reconciliation after PR #26

- Date: 2026-10-13. Tool: OpenAI Codex. Owner: Haina Liu, Forecast Engine.
- Request: update local `main`, inspect the merged implementation and continue the next independent Forecast Engine task without duplicating open pull requests.
- AI-assisted work: audited the merged Forecast Engine, input adapter, reporting-currency service and open branches; updated `docs/forecast-engine.md` to record the actual store → adapter → FX conversion → engine → UI boundary and distinguish merged behavior from remaining scope.
- Scope decision for student review: no multi-account forecast was added. That would require a team rule for combining accounts converted with different rates and effective dates, so it remains explicit future scope rather than an AI assumption.
- Validation: after fast-forwarding `main` through PR #26, `npm run check` passed ESLint, TypeScript, 325 unit tests and the Next.js production build. The student must inspect this documentation diff and remains responsible for staging, committing, pushing and opening the PR.
- Follow-up: after PRs #23 and #30 merged, Codex merged the latest `main` into the documentation branch, retained both appended AI usage entries, and updated the Forecast Engine status, reporting-currency comparison, contribution tolerance and date-validation boundary in response to review. The student reviewed PR #30 separately before it merged. `npm run check` then passed ESLint, TypeScript, 341 unit tests and the Next.js production build.

## Product experience: home page after the forecast and Scenario lab merges

Date: 2026-10-16. Tool: Claude Code. Owner: Gabriel Piraccini, Product Experience.

Task given by the student: check what a signed-out visitor sees on the deployed app before the presentation. The AI did not stage, commit or push.

Found: the public home page still labelled the Liquidity overview and the Scenario lab "In development" and said only cash events were available, although both views have been on main since #20, #18 and #23. It is the first page the examiner opens, so it contradicted the demo.

AI-generated: the three view states set to Available, the Scenario lab description and the "Available today" note rewritten to what works today (exchange-rate shocks are previewed and are not part of the comparison), the first principle no longer mentions sections that are not connected, the landing browser test and the home page paragraph in docs/product-experience.md.

Reviewed and changed by the student: I checked each sentence against the Liquidity overview and Scenario lab on main, and kept the FX shock wording to "preview" so the page does not claim more than the comparison does.
