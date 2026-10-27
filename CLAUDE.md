# Instructions for coding agents

This file is read by Claude Code and is versioned so the instructions given to AI tools are reproducible. It contains no secrets and no personal data. Other agents can use it as context too.

## What this project is

FinTwin Global: a cash-flow and liquidity scenario tool for cross-border small businesses in EUR, USD and SGD, built for the Frankfurt School Financial Software Engineering course. It is an educational prototype. In scope: authentication, workspaces, cash accounts and events, a deterministic forecast, delayed-invoice and percentage FX-shock scenarios, ECB exchange-rate snapshots. Out of scope: open banking, payment execution, advice, ML forecasting, microservices, role hierarchies. Read `docs/requirements.md`, `docs/architecture.md` and `docs/decisions.md` before changing behaviour.

## Commands

```sh
npm ci
npm run check              # lint (no warnings), typecheck, unit tests, build
npm run db:migrate         # applies db/migrations to DATABASE_URL
npm run test:integration   # needs TEST_DATABASE_URL ending in _test
npm run test:e2e           # Playwright on port 3100, needs TEST_DATABASE_URL
npm run verify             # check, test migrations, integration, E2E; CI also runs integration as fse_runtime
```

Node 24 (`.nvmrc`), PostgreSQL 16. Copy `.env.example` to `.env.local` for your own local database. Never point tests at a database whose name does not end in `_test`.

## Architecture rules

- One Next.js modular monolith. Pages and server actions in `src/app`, server-only logic in `src/lib`, shared UI in `src/components`.
- `src/lib/forecast` is pure: no database, network, framework or UI imports. Keep it that way.
- Presentation code does not calculate financial results; it formats what the engine returns.
- Only server-side code reaches PostgreSQL and the ECB. The database driver in `src/lib/db.ts` imports `server-only`; a new store or provider module should import it too, so a client component cannot bundle it.
- Forecasts and scenarios read persisted FX snapshots, never a live price. Show `CURRENT`, `STALE` and `UNAVAILABLE` honestly; never invent or hard-code a rate.
- Scenarios store adjustments and never change base cash events.

## Money, dates and data

- Amounts and rates are decimal strings end to end: `numeric` in PostgreSQL, Decimal in the engine. Do not use JavaScript `number` arithmetic for money. Round only at the presentation boundary (`src/lib/format.ts`, half to even).
- Dates are UTC calendar dates (`YYYY-MM-DD`). A forecast covers at most 366 dates counting both ends.
- Migrations are additive. Never edit a migration that has been applied or shared; add a new numbered file. Grant the runtime role `fse_runtime` only the columns it needs, inside a guarded `DO` block like the existing migrations. Since #27, CI compares the runtime role's actual privileges with a fixed list, so a new or changed grant must change in three places together: the migration, the grant table in `docs/deployment.md` and the expected map in `tests/integration/runtime-privileges.test.ts` (base grants that no migration gives also live in `scripts/ci-runtime-role.mjs`). Otherwise CI fails with a privilege mismatch.

## Security rules

- Ownership comes from the session in the database, never from an id sent by the browser. Every store query starts at the session token and joins down user, workspace, account, event.
- Validate every input on the server with the schemas in `src/lib/validation.ts`.
- Never commit `.env*` files (except `.env.example`, which holds placeholders only), credentials, tokens or real personal data. Do not paste secrets or real financial data into an AI tool. Do not log balances, tokens or passwords.
- A change that touches authentication, authorization or a migration needs a test showing that user A cannot read or change user B's data.

## Tests

- Unit tests in `tests/unit`, database integration tests in `tests/integration`, browser tests in `tests/e2e` (helpers in `tests/e2e/fixtures.ts`).
- Tests relate to a requirement in `docs/requirements.md`. Include the edge and failure cases (empty input, foreign id, expired session, provider failure).
- Every private page is checked against WCAG 2.2 AA in light and dark mode by `tests/e2e/accessibility.spec.ts`; keep it passing and make pages usable at 375 px width without sideways scrolling.
- Do not weaken or delete an assertion to make a test pass. If a test fails, find out whether the page or the test is wrong and say which.

## Git workflow

- Feature branch, small commits, pull request, a genuine review from another team member, green CI, then merge. No direct pushes to `main`; do not merge your own pull request without a review.
- AI agents may help write or review code, but must not stage, commit or push changes for us: the team member inspects the diff, runs the tests and commits. Leave the changes in the working tree and say what was changed and how it was checked.
- State dependencies between pull requests in the description. Do not claim a deployment succeeded when Vercel reports it as blocked or failed.
- Do not publish the project with `vercel deploy` from a working tree; deployments come from the GitHub integration (see `docs/deployment.md`).

## Documentation and AI record

- Keep docs in step with the code in the same pull request: requirements, architecture and database diagrams, testing, security, limitations.
- For substantial AI-assisted work, add an entry to `docs/ai-usage.md`: tool, task, what the AI generated, what a human reviewed, corrected or rejected, and the validation that was run. Include at least one concrete correction when there was one.
- Say what was verified and what was not. "Tests pass" must be backed by a command that was run.
