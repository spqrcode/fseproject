# Git workflow and CI/CD

How a change gets from an idea to the deployed application. The same rules apply to code written by hand and code drafted with an AI agent; the agent-specific rules are in [CLAUDE.md](../CLAUDE.md).

## Branches and commits

- `main` holds what is deployed. Nobody pushes to it directly.
- Each change lives on its own short-lived branch, named after its purpose: `feat/…` for features, `fix/…` for bug fixes, `docs/…` for documentation and `chore/…` for tooling. For example `feat/monthly-recurring-events`, `fix/fx-shock-bounds-and-errors` or `docs/architecture-diagrams`.
- Commits are small and say why, not only what. Migrations are additive: an applied migration is never edited; a new numbered file is added instead.

## Pull requests

Every change reaches `main` through a pull request. The description states:

- the user story or feedback item it belongs to;
- what changed and the trade-offs;
- security and failure cases where relevant;
- the validation that was actually run (commands and results);
- dependencies on other pull requests.

Documentation changes go in the same pull request as the code they describe. Substantial AI-assisted work gets an entry in [AI usage](ai-usage.md).

## Review

- Another team member reviews every pull request. Reviews regularly cross areas: the Forecast Engine owner reviews scenario code, the scenario owner reviews the engine documentation, and so on. This is how everyone came to know the whole system.
- A reviewer either approves, comments, or requests changes. Requested changes are answered with a new commit and a reply in the pull request, then reviewed again. Examples: #24 (silent rounding in a migration found in review), #34 (a metric definition corrected to match the engine), #37 (merge conflict and rationale).
- A pull request that is behind `main` is updated by merging `main` into it. Conflicts in append-only documents such as `docs/ai-usage.md` keep both entries.

## Quality gate: CI

GitHub Actions runs `.github/workflows/ci.yml` on every pull request and on every push to `main`:

1. Install dependencies with `npm ci` on Node 24.
2. Start a fresh PostgreSQL 16, create the restricted role `fse_runtime`, and apply all migrations.
3. ESLint with zero warnings, then strict TypeScript.
4. Unit tests.
5. Database integration tests.
6. The data-store integration tests again, connected as `fse_runtime`, including a check of its exact privileges.
7. Production build.
8. Playwright browser tests on the production build, including WCAG 2.2 AA checks.

The same sequence runs locally with `npm run verify` ([testing](testing.md)).

## Branch protection

`main` is protected: a change needs a pull request, one approval from another member and a passing `verify` check. A failing or flaky test blocks merging until it is fixed. For example, PR #36 fixed an order-dependent test that blocked #35.

## Deployment

Merging to `main` is the only way into the deployed application. Vercel builds from the GitHub repository, never from a local working folder, because a working-folder upload once included git-ignored files (see [decisions](decisions.md)). Database migrations are applied separately with the owner connection before the code that needs them is deployed. Details and the current deployments: [deployment](deployment.md).
