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

## Issue 2 — Holdings CRUD and ownership isolation

- Tool: Claude (Opus 5) in Claude Code, continuing from the Codex work recorded above.
- Instruction: implement Issue 2 only, keep the existing authentication architecture unchanged, add no new infrastructure, and leave PR #2 open for a real student review.
- Generated work: migration `003_holdings.sql`, `src/lib/holdings-store.ts`, `src/app/actions/holdings.ts`, `src/components/holdings.tsx`, holdings validation in `src/lib/validation.ts`, unit and integration cases, `tests/e2e/holdings.spec.ts`, and these documentation updates.
- Validation: `npm run verify` from the existing test database — lint, strict TypeScript, 33 unit tests, production build, migrations, 36 integration tests against real PostgreSQL, 8 Chromium tests. Results are recorded in the pull request.

Problems found while writing the code, worth being able to explain:

1. **The obvious `CHECK (quantity > 0)` does not reject `NaN`.** PostgreSQL sorts `NaN` above every other numeric, so `'NaN'::numeric > 0` is true and the row would be stored. The constraint excludes `NaN` explicitly, and an integration test inserts `'NaN'` with direct SQL to prove the database refuses it without help from the form.
2. **A first draft let the input schema and the column disagree.** The schema allowed a maximum of `1000000000000`, which is 13 digits, while `numeric(20, 8)` holds 12. A value the form accepted would have failed at the database with an unhelpful error. The digit bounds now match the column exactly and the requirements state them.
3. **A test assertion was wrong, not the code.** `TOOLONGSYM` was expected to be rejected; the ticker pattern allows ten characters, so it is valid. The test was corrected rather than the pattern loosened or tightened to make it pass.
4. **A successful removal showed no confirmation.** The success notice lived inside the row it deleted, so it unmounted immediately. Rather than move state around, the row disappearing is the confirmation and only failures render a message. This is stated in the testing document so it is not mistaken for a missing feature.
5. **`getByRole("alert")` also matched Next.js's route announcer**, the same trap recorded in Issue 1. The browser tests exclude that element by id instead of weakening the selector, and the announcer stays in the page.

Student review: pending. Nothing in this entry should be read as a student approval, and no review has been attributed to a team member who has not written one.
