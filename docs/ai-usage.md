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

## Login throttle fix and origin test coverage (branch `fix/auth-throttle`)

Date: 2026-09-29. Tool: Claude Code (Claude Sonnet 5.5). Owner: Foundation & Security student.

Problem found by the student: the throttle counted successful logins (10 correct sign-ins in 15 minutes locked the account) and shared its counter with registration, so anyone could lock a known email through the register form. The origin (CSRF) test covered only `register` and `login`.

AI-generated: the split of `allowAuthAttempt` into `authAttemptsAllowed` (read-only check), `recordFailedAuth` and `clearAuthAttempts` in `src/lib/rate-limit.ts`; `login`/`register` changes in `src/app/actions/auth.ts`; the new integration tests (12 successful logins, lockout after 10 failures and window reset, counter reset on success, registration not blocking login, origin checks for `logout` and `updatePortfolio`); the `docs/security.md` throttle section. The student specified the required behaviour and approved the plan before any code was written.

Reviewed and changed by the student: reviewed the full diff before committing. Removed an unnecessary .gitignore change (duplicate node_modules entry) and found that the browser-test cleanup still deleted the old account: throttle key; updated it to the new login:/register: keys.

PR review finding: the AI-generated `clearAuthAttempts` used `DELETE` on `auth_limits`, but the staging runtime role `fse_runtime` has only SELECT/INSERT/UPDATE there (`docs/deployment.md`), so every successful login would have failed on staging. Neither the AI output nor the student's own diff review caught it, and the integration tests could not, because they connect as the database owner. Fix: `clearAuthAttempts` now closes the window with `UPDATE auth_limits SET reset_at = now() WHERE key = $1 AND reset_at > now()` (no new privilege, no migration); the `scope` argument of `allowAuthAttempt` is now required so login cannot fall back to the increment-first path; the reset test now asserts no open window rather than no row.

AI-flagged trade-off: check-then-increment is not atomic, so parallel wrong guesses can slightly overshoot the limit. Documented in `docs/security.md`.

Validation (2026-09-29, local, Node 24, PostgreSQL 16): npm run verify passed. ESLint (zero warnings) and strict TypeScript clean; 8 unit tests, 26 integration tests (previously 20), 4 Chromium tests passed; production build succeeded; test migrations applied.

