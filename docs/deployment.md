# Delivery and collaboration

Status: Git repository, GitHub remote, CI, and hosting have not been configured.

## Git workflow

Create a GitHub repository with a minimal initial main branch, then use small feature branches and pull requests. The proposed first branch is `docs/project-baseline`. Application development must not occur directly on main.

Each PR links a user story, states acceptance criteria, explains the change, records tests and security review, and names an independent student reviewer. Protect main with required checks and reviews where the account supports it. Do not fabricate authorship, reviews, commits, or collaboration evidence.

## Four-person collaboration

Agree student names and assign initial leads for UI/accessibility, database/authentication, market data/calculations, and CI/testing/documentation. Rotate review responsibilities so each student reviews an area outside their initial lead role. Everyone must understand the full request flow and ownership enforcement.

Keep issue assignments, meaningful commits, PR discussions, review-driven changes, and CI runs as evidence. AI output does not count as a second student's review.

## Planned CI/CD

Pull requests install dependencies from the lockfile and run lint, TypeScript checks, unit tests, isolated authorization integration tests, a production build, and relevant end-to-end tests. Exact commands and environment setup will be committed with tooling.

Use Vercel previews for review and a production deployment from approved main. Verify how production promotion is gated on successful checks: a deploy triggered merely by a push is not proof that CI passed.

Separate local/test and assessment data. Preview environments must not mutate assessment data. Database migrations are versioned and tested before application changes relying on them reach production. Prefer additive migrations; record migration ordering and recovery steps in affected PRs.

## Deployment verification

Before assessment, record the public URL and deployed commit. Verify registration/login, redirects, protected routes, ownership isolation, persistence, live quote retrieval, failure states, and secret configuration. Public accessibility applies to the application entry point, not users' private data.

Document environment variable names and purposes without values when configuration exists. A rollback to an older application may not undo a database migration; confirm compatibility before rollback.

## Evidence still required

Repository URL, team identities, branch rules, CI workflow, successful run links, environment configuration, migration procedure, deployment URL, deployment smoke-test results, and recovery instructions.

## Hosting constraint

Vercel is permitted for the application. Develop against local PostgreSQL. Public assessment requires a persistent PostgreSQL server reachable securely from the deployed application, such as university infrastructure. No hosted backend/auth platform is planned. Database hosting and available free-tier limits remain unverified; do not promise zero-cost deployment until both are confirmed.
