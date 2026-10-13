# Portfolio Risk Dashboard

Investment portfolio tracker for the Financial Software Engineering course at Frankfurt School.

## Current scope

The implemented foundation provides account registration, login/logout, database-backed sessions, protected pages, workspaces, cash accounts and cash events. This increment adds a server-only ECB exchange-rate provider and validated PostgreSQL snapshot cache for EUR, USD and SGD. The FX data layer is not yet connected to Scenario Lab on this branch. Holdings, market quotes and `/analytics` are outside the current cash-forecast MVP. No Supabase or hosted authentication service is used.

The interface is branded FinTwin Global. Signed-out visitors see a public home page at `/`. Signed-in users get navigation for the three MVP views, Liquidity overview, Cash events and Scenario lab, which show a not-connected state until their parts are delivered, a Workspace page, and a settings page with the reporting currency, a light, dark or device appearance, and their active sessions with a sign-out for the others. Every page is checked automatically against WCAG 2.2 AA rules in both themes. See [product experience](docs/product-experience.md).

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

## Demo data

For a presentation, register a demo user in the browser first (the password stays with the person who chose it), then seed a workspace for it:

```sh
npm run demo:seed -- --email demo@example.com --dry-run
npm run demo:seed -- --email demo@example.com
```

`DATABASE_URL` selects the database; seed a hosted database with the owner connection, as for migrations. The script adds a euro operating account, US receivables and a Singapore office with sixteen expected events dated from today, and two scenarios: a customer invoice three weeks late (the euro account falls below its danger threshold on payroll day) and a US client paying 30 days late. It creates no user or password, inserts no exchange rate, runs in one transaction, and refuses a workspace that already has cash accounts. See `scripts/demo-seed.mjs`.

## Verify Issue 1

```sh
npx playwright install chromium
npm run verify
```

`verify` runs lint (no warnings), TypeScript, unit tests, a production build, test migrations, database integration tests, and Chromium end-to-end tests. Integration and browser tests require a `TEST_DATABASE_URL` ending in `_test`; they override `DATABASE_URL` for their own processes. Browser tests launch a production server on port 3100 and never reuse your development server. On Linux, install browser dependencies with `npx playwright install --with-deps chromium`.

Node 24 is declared in `.nvmrc`, `package.json` (also used by Vercel), and GitHub Actions. Dependencies are pinned in `package-lock.json`; Node patch releases remain managed by each environment.

## Engineering documentation

- [Requirements and traceability](docs/requirements.md)
- [Architecture](docs/architecture.md) and [database](docs/database.md)
- [Decisions](docs/decisions.md), [security](docs/security.md), and [limitations](docs/limitations.md)
- [Testing](docs/testing.md) and [deployment](docs/deployment.md)
- [Forecast Engine working draft](docs/forecast-engine.md)
- [Product experience](docs/product-experience.md)
- [AI use and corrections](docs/ai-usage.md)
- [Issue 1 evidence](docs/issue-1-evidence.md)

Work uses small feature branches and reviewed PRs in [spqrcode/fseproject](https://github.com/spqrcode/fseproject). Student review and the later financial features remain separate work.
