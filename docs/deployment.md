# Deployment

Repository: https://github.com/spqrcode/fseproject. Application work stays on `feat/auth-foundation` and reaches main only through a reviewed PR.

## Staging configuration

Existing Vercel project: `fseproject`, project ID `prj_kDOrGWxd4htfHHHHTVbUtuQVXa1v`, linked to that exact GitHub repository. Node 24.x matches `.nvmrc` and `package.json`. Staging is a Preview deployment; production promotion is not part of Issue 1.

PostgreSQL: dedicated Neon resource `fseproject-staging`, free_v3 plan, Frankfurt, managed authentication disabled. The service provisioned PostgreSQL 18.6; local/CI PostgreSQL is 16.15/16. The SQL uses features common to both. Staging migrations were applied successfully. Certificate-verified TLS was checked on the actual client connection; backend `pg_stat_ssl` is not evidence of client TLS when a provider proxy terminates it.

Runtime role `fse_runtime` has only SELECT/INSERT on users, SELECT/INSERT/DELETE on sessions, and SELECT/INSERT/UPDATE on auth_limits and workspaces (the former `portfolios` table; the renamed table keeps its grants), and UPDATE on the `users.reporting_currency` and `users.appearance` columns only (granted by migrations 003 and 004). Migration 005 grants, only if the role exists:

| Table | Grant | Why |
| --- | --- | --- |
| cash_accounts | SELECT, INSERT | List and create accounts; reads also back the rows the application changes |
| cash_accounts | UPDATE on `name`, `updated_at` | Renaming. Not `currency`, `opening_balance` or `workspace_id`, so a faulty query cannot change a currency or move an account |
| cash_events | SELECT, INSERT | List and create events |
| cash_events | UPDATE on `description`, `amount`, `expected_date`, `status`, `updated_at` | Editing and status changes. Not `account_id` or `workspace_id`, so an event cannot be moved to another account or workspace |
| cash_events | DELETE | Deleting an event |
| workspaces | none new | Existing SELECT/INSERT/UPDATE covers the workspace upsert and `danger_threshold`; the application never deletes a workspace |

There is no DELETE on `cash_accounts`: no application function deletes accounts. Deleting a user (owner only) cascades through workspace, accounts and events with the owner's rights. It cannot create schema objects or write migration history. The database owner is used separately for migrations. Administrator connection files remain ignored and owner-readable locally; they must not be committed or provided to the application.

Migration 006 creates the global ECB snapshot cache. If `fse_runtime` exists when the owner applies it, the role receives SELECT and INSERT on `fx_snapshots`, plus UPDATE only on `fetched_at` for a repeated identical observation. A corrected rate is a new immutable row. The role receives no DELETE and cannot rewrite a snapshot's provider, currencies, rate or effective date. Snapshot cleanup remains an owner maintenance operation. Migration 006 is additive and may be applied before the FX service is deployed.

Preview variables: `DATABASE_URL` (restricted runtime connection, sensitive), `APP_ORIGIN` (exact canonical HTTPS staging origin). No production or development connection to staging is intended. Do not overwrite local `.env.local` with staging credentials.

## Delivery and manual checks

1. Run `npm ci`, install the Playwright browser, and run `npm run verify`.
2. Review and push the feature branch to the repository above; GitHub Actions runs all checks on the PR.
3. Apply additive migrations with a separate owner connection, using `node scripts/migrate.mjs` with DATABASE_URL supplied securely. Never run schema changes through the runtime role.
4. Push the branch. The GitHub integration builds the Preview; assign the canonical staging alias to that Git-source deployment. Do not publish this project with `vercel deploy` from a working tree — see the deployment decision record. APP_ORIGIN must match the URL used for sign-in.
5. Visit `/register`, create a test account with a 15-character-or-longer password, sign in, create a named workspace, reload, sign out, then reopen `/workspace` and confirm login is required.

The staging sign-in page is public, as requested. Application authentication still protects private pages and data. Vercel's additional login wall is disabled only for this school project.

Main branch protection and a student review are still required. GitHub/Vercel integration can build previews before CI finishes; preview availability alone is not approval for production. Do not promote until the PR checks and human review pass. Application rollback does not roll back database migrations.

## Migration 005 is not backward-compatible

Migration `005_workspace_cash_events.sql` renames the table `portfolios` to `workspaces`. Code from before this change reads and writes `portfolios`; code from this change uses `workspaces`. On staging and production, run the migration immediately before (or together with) deploying this code. Between the two steps either the old or the new code will fail on every workspace query (sign-in is unaffected). Run it with the owner connection as in step 3 above, then deploy straight away. Rolling back the application does not roll back the migration; rolling back needs `ALTER TABLE workspaces RENAME TO portfolios` by the owner (the new tables and `danger_threshold` can stay).

## Production

The project has no working production deployment. The only production-target build is an errored one from the documentation-only commit made before any application code existed. Production comes with the merge to `main` plus production-target environment variables and its own database; that is deliberately outside Issue 1, which asked for staging.
