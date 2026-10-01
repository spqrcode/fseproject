# Deployment

Repository: https://github.com/spqrcode/fseproject. Application work stays on `feat/auth-foundation` and reaches main only through a reviewed PR.

## Staging configuration

Existing Vercel project: `fseproject`, project ID `prj_kDOrGWxd4htfHHHHTVbUtuQVXa1v`, linked to that exact GitHub repository. Node 24.x matches `.nvmrc` and `package.json`. Staging is a Preview deployment; production promotion is not part of Issue 1.

PostgreSQL: dedicated Neon resource `fseproject-staging`, free_v3 plan, Frankfurt, managed authentication disabled. The service provisioned PostgreSQL 18.6; local/CI PostgreSQL is 16.15/16. The SQL uses features common to both. Staging migrations were applied successfully. Certificate-verified TLS was checked on the actual client connection; backend `pg_stat_ssl` is not evidence of client TLS when a provider proxy terminates it.

Runtime role `fse_runtime` has only SELECT/INSERT on users, SELECT/INSERT/DELETE on sessions, and SELECT/INSERT/UPDATE on auth_limits and portfolios. It cannot create schema objects or write migration history. The database owner is used separately for migrations. Administrator connection files remain ignored and owner-readable locally; they must not be committed or provided to the application.

Preview variables: `DATABASE_URL` (restricted runtime connection, sensitive), `APP_ORIGIN` (exact canonical HTTPS staging origin). No production or development connection to staging is intended. Do not overwrite local `.env.local` with staging credentials.

## Delivery and manual checks

1. Run `npm ci`, install the Playwright browser, and run `npm run verify`.
2. Review and push the feature branch to the repository above; GitHub Actions runs all checks on the PR.
3. Apply additive migrations with a separate owner connection, using `node scripts/migrate.mjs` with DATABASE_URL supplied securely. Never run schema changes through the runtime role.
4. Push the branch. The GitHub integration builds the Preview; assign the canonical staging alias to that Git-source deployment. Do not publish this project with `vercel deploy` from a working tree — see the deployment decision record. APP_ORIGIN must match the URL used for sign-in.
5. Visit `/register`, create a test account with a 15-character-or-longer password, sign in, create a named portfolio, reload, sign out, then reopen `/portfolio` and confirm login is required.

The staging sign-in page is public, as requested. Application authentication still protects private pages and data. Vercel's additional login wall is disabled only for this school project.

Main branch protection and a student review are still required. GitHub/Vercel integration can build previews before CI finishes; preview availability alone is not approval for production. Do not promote until the PR checks and human review pass. Application rollback does not roll back database migrations.

## Production

The project has no working production deployment. The only production-target build is an errored one from the documentation-only commit made before any application code existed. Production comes with the merge to `main` plus production-target environment variables and its own database; that is deliberately outside Issue 1, which asked for staging.
