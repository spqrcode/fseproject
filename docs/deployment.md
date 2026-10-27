# Deployment

Repository: https://github.com/spqrcode/fseproject (public). Every change reaches `main` through a reviewed pull request with a passing `verify` check; see [Git workflow](git-workflow.md).

## Current deployments (27 October 2026)

| Deployment | URL | Built from | Database | Purpose |
| --- | --- | --- | --- | --- |
| Staging (canonical) | https://fseproject-staging.vercel.app | `main` of `spqrcode/fseproject`, Vercel project `fseproject`, Preview environment | Neon `fseproject-staging`, Frankfurt, migrations 001–009 | The address for the assessment and the presentation |
| Backup | https://fintwin-global.vercel.app | `main` of the mirror `JiaxinHuang77/fseproject` (the same commits), Vercel project `fintwin-global`, Production environment | A separate Neon project, Frankfurt, migrations 001–009 | Fallback if staging is unavailable; holds the presentation's demo data |
| Production domain of the Vercel project `fseproject` | https://fseproject.vercel.app | `main` | None configured | Not used: without a database only the public pages work. Do not hand it out |

Both deployments that are used connect as the restricted role `fse_runtime` described below. The database owner is used only for migrations.

## Staging configuration

Vercel project `fseproject`, project ID `prj_kDOrGWxd4htfHHHHTVbUtuQVXa1v`, linked to that exact GitHub repository. Node 24.x matches `.nvmrc` and `package.json`. Staging is a Preview deployment of `main` with its own environment variables; after each merge the staging alias is moved to the newest build of `main`.

PostgreSQL: dedicated Neon resource `fseproject-staging`, free_v3 plan, Frankfurt, managed authentication disabled. The service provisioned PostgreSQL 18.6; local/CI PostgreSQL is 16.15/16. The SQL uses features common to both. Staging migrations were applied successfully. Certificate-verified TLS was checked on the actual client connection; backend `pg_stat_ssl` is not evidence of client TLS when a provider proxy terminates it.

The base grants below (those on `users`, `sessions`, `auth_limits` and `workspaces`, which no migration gives) also exist as executable code in `scripts/ci-runtime-role.mjs`, which CI uses to run the data-store integration tests as this role (see [testing](testing.md)); change both together. The grant table in this section (the base grants and the grants of migrations 003-008) is checked by `tests/integration/runtime-privileges.test.ts`, which compares what `fse_runtime` can actually do, table by table and column by column, with an explicit map and fails on a missing or an extra privilege; the table, that map and the grants must change together. Runtime role `fse_runtime` has only SELECT/INSERT on users, SELECT/INSERT/DELETE on sessions, and SELECT/INSERT/UPDATE on auth_limits and workspaces (the former `portfolios` table; the renamed table keeps its grants), and UPDATE on the `users.reporting_currency` and `users.appearance` columns only (granted by migrations 003 and 004). Migration 005 grants, only if the role exists:

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

Migration 007 adds delayed-invoice scenario tables. If `fse_runtime` exists when the owner applies it, the role receives SELECT and INSERT on `scenarios` and `scenario_adjustments`, plus UPDATE only on adjustment `status` and `updated_at`. It has no direct DELETE or ownership-column UPDATE grant. Owner-side user/workspace cleanup still follows the foreign-key cascades. Apply this additive migration before deploying the scenario store.

Migration 008 adds `scenario_fx_shocks`. The guarded runtime grants allow SELECT and INSERT plus UPDATE only on `status` and `updated_at`; the role cannot change ownership, snapshot provenance or the stored percentage, and receives no DELETE permission. Apply it before deploying the shock store.

Preview variables: `DATABASE_URL` (restricted runtime connection, sensitive), `APP_ORIGIN` (exact canonical HTTPS staging origin). No production or development connection to staging is intended. Do not overwrite local `.env.local` with staging credentials.

## Delivery and manual checks

1. Run `npm ci`, install the Playwright browser, and run `npm run verify`.
2. Review and push the feature branch to the repository above; GitHub Actions runs all checks on the PR.
3. Apply additive migrations with a separate owner connection, using `node scripts/migrate.mjs` with DATABASE_URL supplied securely. Never run schema changes through the runtime role.
4. Push the branch. The GitHub integration builds the Preview; assign the canonical staging alias to that Git-source deployment. Do not publish this project with `vercel deploy` from a working tree — see the deployment decision record. APP_ORIGIN must match the URL used for sign-in.
5. Visit `/register`, create a test account with a 15-character-or-longer password, sign in, create a named workspace, reload, sign out, then reopen `/workspace` and confirm login is required.

The staging sign-in page is public, as requested. Application authentication still protects private pages and data. Vercel's additional login wall is disabled only for this school project.

`main` is protected: a change needs a pull request, one approval from another member and a passing `verify` check. The GitHub/Vercel integration can build previews before CI finishes; preview availability alone is not approval. Application rollback does not roll back database migrations.

## Migration 005 is not backward-compatible

Migration `005_workspace_cash_events.sql` renames the table `portfolios` to `workspaces`. Code from before this change reads and writes `portfolios`; code from this change uses `workspaces`. On staging and production, run the migration immediately before (or together with) deploying this code. Between the two steps either the old or the new code will fail on every workspace query (sign-in is unaffected). Run it with the owner connection as in step 3 above, then deploy straight away. Rolling back the application does not roll back the migration; rolling back needs `ALTER TABLE workspaces RENAME TO portfolios` by the owner (the new tables and `danger_threshold` can stay).

## Production domain

The Vercel project's production domain (https://fseproject.vercel.app) builds `main` but has no database variables, so sign-in and every private page fail there. It is not used; staging is the canonical deployment. Giving it a database would mean a second set of production-target variables and its own migrated database, which the assessment does not need.

## Backup deployment

The backup at https://fintwin-global.vercel.app was set up on 16 October 2026, when the staging deployment was briefly blocked, so the presentation would not depend on a single account.

- Source: a private mirror, `JiaxinHuang77/fseproject`, of this repository. It receives the same commits: `git fetch origin && git push mirror origin/main:main`. It adds no code of its own.
- Build: Vercel builds from the mirror on GitHub, never from a working folder. On the Hobby plan, Vercel blocks Git-triggered builds of commits whose author is not the account owner, so after a sync the production build of `main` is requested through the Vercel API with the same GitHub commit as its source.
- Database: a separate Neon project in Frankfurt. The role `fse_runtime` was created first with a generated password, then the owner applied migrations 001–009 and the base grants, in the same order as `scripts/ci-runtime-role.mjs` and CI. The application's `DATABASE_URL` is the pooled `fse_runtime` connection, stored only as a sensitive Vercel variable; `APP_ORIGIN` is `https://fintwin-global.vercel.app`.
- Demo data: seeded with `npm run demo:seed` for an account registered in the browser.

## Preview deployments blocked by commit author

Vercel can report a preview as "Deployment was blocked" with the message that GitHub could not verify an account for the commit. This is not a build or test failure: it happens when the commit's author email is not linked to a GitHub account that is a member of the Vercel team. The pull request's own checks (`verify` in GitHub Actions) run independently of it. To fix it, add the commit email to the author's GitHub account and connect that account to the Vercel team, then push a new commit. Until then, treat the preview as unavailable and do not count it as a successful deployment.

