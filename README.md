# Portfolio Risk Dashboard

Investment portfolio tracker for the Financial Software Engineering course at Frankfurt School.

## Current scope

The implemented foundation provides account registration, login/logout, database-backed sessions, protected pages, workspaces, cash accounts and cash events. The foundation also has a server-only ECB exchange-rate provider with a validated PostgreSQL snapshot cache for EUR, USD and SGD, the deterministic Forecast Engine, forecast input for one account, and the data layer for delayed-invoice scenarios and percentage FX shocks. The Scenario Lab page uses them: it delays invoices and previews and saves ECB exchange-rate shocks. Holdings, market quotes and `/analytics` are outside the current cash-forecast MVP. No Supabase or hosted authentication service is used.

The interface is branded FinTwin Global. Signed-out visitors see a public home page at `/`. Signed-in users get navigation for the three MVP views, Liquidity overview, Cash events and Scenario lab, all three live on `main` (see the status table below for what is still in review), a Workspace page, and a settings page with the reporting currency, a light, dark or device appearance, and their active sessions with a sign-out for the others. Every page is checked automatically against WCAG 2.2 AA rules in both themes. See [product experience](docs/product-experience.md).

## Deployed application and demo access

- **URL:** https://fseproject-staging.vercel.app (staging, a Vercel deployment of this repository with a managed PostgreSQL database in Frankfurt). How it is built, configured and promoted is in [deployment](docs/deployment.md). The staging address points at the deployment someone assigned to it, so it can lag `main`; the status table below says what is expected to be live.
- **Demo access:** there is no shared demo account and no credentials are committed. Open `/register`, create an account with any address and a 15–128 character passphrase (no email is sent and the address is not verified), and sign in. Use a throwaway address and a passphrase you do not use elsewhere.
- **Suggested check in a private window:** `/dashboard` redirects to `/login` when signed out; register, sign in, name a workspace, change the reporting currency and appearance in settings, sign out, sign in again and confirm everything persisted; open another browser and confirm the second account sees none of it.

Status of the three business views on `main`, as of 12 October 2026. Update this table when a pull request merges.

| View | On `main` | Pull request |
| --- | --- | --- |
| Liquidity overview (`/dashboard`) | Live: one account's forecast for 30 to 365 days with chart, runway and danger threshold, in the account's currency | #20, merged; reporting-currency conversion in #26 |
| Cash events (`/cash-events`) | Live: accounts and expected events; create, edit, settle, cancel and delete | #16, merged |
| Scenario Lab (`/scenarios`) | Live: delayed invoices, ECB shock preview and saved shocks with their snapshot | #18, merged; base versus scenario comparison in #23; shock bounds in #24 |

A seeded demo dataset is not provided yet; see [presentation feedback](docs/presentation-feedback.md) for open work.

## Local setup

Prerequisites: Node.js 24, npm, and a running PostgreSQL 16 server. PostgreSQL must be installed separately; the application does not install or start a database service.

```sh
nvm install
nvm use
npm ci
createdb portfolio_risk
createdb portfolio_risk_test
cp .env.example .env.local
```

Set `DATABASE_URL`, `TEST_DATABASE_URL`, and `APP_ORIGIN` in `.env.local` for your PostgreSQL role and port. The example credentials are placeholders. If your database is remote, pass its host and user options to `createdb` and use certificate-verified TLS. Keep test data separate from development and staging.

```sh
npm run db:migrate
npm run dev
```

Open [localhost:3000](http://localhost:3000), register with an email address and a 15–128 character passphrase, then sign in. Email delivery and password recovery are not implemented; registration does not verify ownership of the email address.

## Verify Issue 1

```sh
npx playwright install chromium
npm run verify
```

`verify` runs lint (no warnings), TypeScript, unit tests, a production build, test migrations, database integration tests, and Chromium end-to-end tests. Integration and browser tests require a `TEST_DATABASE_URL` ending in `_test`; they override `DATABASE_URL` for their own processes. Browser tests launch a production server on port 3100 and never reuse your development server. On Linux, install browser dependencies with `npx playwright install --with-deps chromium`.

Node 24 is declared in `.nvmrc`, `package.json` (also used by Vercel), and GitHub Actions. Dependencies are pinned in `package-lock.json`; Node patch releases remain managed by each environment.

## Engineering documentation

- [Requirements and traceability](docs/requirements.md)
- [Architecture](docs/architecture.md) (component diagram) and [database](docs/database.md) (entity-relationship diagrams)
- [Decisions](docs/decisions.md), [security](docs/security.md), and [limitations](docs/limitations.md)
- [Testing](docs/testing.md) and [deployment](docs/deployment.md)
- [Forecast Engine working draft](docs/forecast-engine.md)
- [Product experience](docs/product-experience.md)
- [AI use and corrections](docs/ai-usage.md); coding-agent instructions are versioned in [CLAUDE.md](CLAUDE.md)
- [Presentation feedback and decisions](docs/presentation-feedback.md)
- [Issue 1 evidence](docs/issue-1-evidence.md)

Work uses small feature branches and reviewed PRs in [spqrcode/fseproject](https://github.com/spqrcode/fseproject). Student review and the later financial features remain separate work.
