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

## Product experience increment: FinTwin Global shell, formatting and reporting currency

Date: 2026-10-01. Tool: Claude Code. Owner: Product Experience student (member D).

Request: review the open pull requests, then advance the Product Experience task while the FinTwin Global domain model is still being agreed by the team. Following the team rule, the AI did not stage, commit or push: the changes were delivered as a patch for the student to inspect, test and commit.

AI-generated: the FinTwin Global branding and editorial visual design (stylesheet, self-hosted fonts, logo mark, placeholder figures), requested by the student after a first version looked like a generic AI-generated dashboard; navigation for Overview, Forecast, Scenarios, Portfolio and Settings; forecast and scenario pages with honest not-connected states; in-shell loading and error states; `PageHeading`, `EmptyState` and `Brand` components; `src/lib/format.ts` and `src/lib/currency.ts`; the reporting currency migration, store, server action, form and settings page; unit, integration and browser tests; `docs/product-experience.md` and the related documentation updates.

Problems found in the AI's own output by the tests before delivery: the first currency form used a controlled select with a comment claiming React's automatic form reset could not affect it. The browser test showed the select jumping back to EUR after USD had been saved. The select is now keyed by the saved currency and a regression assertion was added. Installing the font packages with the container's older npm rewrote unrelated `libc` entries in `package-lock.json`; the lockfile was restored and only the three font entries were added, then checked with `npm ci`. A first skip-link test assumed the focus position after a client-side redirect and failed for that reason; it now loads the page before pressing Tab.

Student review and corrections (covers this entry and the follow-up below): to be completed by the student before the pull request is reviewed (what was checked in the diff, what was changed or rejected, and why).

Validation (2026-10-01, cloud container with Node 22.22 and PostgreSQL 16; the project targets Node 24, so the full suite must be rerun locally): migrations applied from an empty test database and a second run applied nothing; ESLint with zero warnings and strict TypeScript clean; 35 unit tests, 36 integration tests (20 before) and 11 Chromium tests (4 before) passed; production build succeeded. The browser suite also passed with the application connected as a role holding exactly the staging privileges listed in `deployment.md`. Deliberately removing the origin check or the session expiry condition made the new integration tests fail.

Related review work: while reviewing PR #6 with AI assistance, the same staging-privilege run showed that every login fails on that branch, because the new `clearAuthAttempts` deletes from `auth_limits` and the runtime role has no `DELETE` there. This was reported in the PR review with a reproduction and a proposed fix.

## Product experience follow-ups: home page, sessions, appearance and accessibility checks

Date: 2026-10-01. Tool: Claude Code. Owner: Product Experience student (member D). Same branch and delivery as the entry above: patches inspected, tested and committed by the student.

AI-generated: the public home page; the active sessions list and the action that signs out other sessions; the appearance preference (migration 004, store, action, form, dark palette); shared Playwright fixtures; `tests/e2e/accessibility.spec.ts` with `@axe-core/playwright`; the matching documentation.

Problems found in the AI's own output by the tests before delivery:
1. The appearance cards hid the real radio buttons with `pointer-events: none`, so only the label could be clicked and the browser test could not select an option. The invisible radio button now covers its whole card.
2. Keeping the current menu item visible on phones was first done with `scrollIntoView`. In Chrome that also moves the keyboard starting point onto the link, so the first Tab skipped the "Skip to content" link; the existing skip-link test caught it. The menu container is now scrolled directly, which leaves focus alone.
3. Adding `@axe-core/playwright` with the container's older npm would again have rewritten unrelated lockfile entries; only the one new entry was added and checked with `npm ci`.

The accessibility check was itself checked: making the muted text colour lighter turns both light-mode runs red with colour-contrast errors.

Validation (2026-10-01, cloud container with Node 22.22 and PostgreSQL 16; the full suite must be rerun on Node 24): four migrations applied from an empty test database and a second run applied nothing; ESLint with zero warnings and strict TypeScript clean; 37 unit tests, 51 integration tests and 22 Chromium tests passed; production build succeeded. The browser suite also passed with the application connected as a role holding exactly the staging privileges, which after migrations 003 and 004 include `UPDATE` on `users.reporting_currency` and `users.appearance` only. Deliberately removing the user predicate or the caller's expiry condition from the session-revoking query made the new integration tests fail.
