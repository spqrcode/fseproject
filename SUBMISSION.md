# FinTwin Global: guide for the assessment

Financial Software Engineering, Frankfurt School, group "Grace Hopper": Bastian Bundschuh, Haina Liu, Jiaxin Huang, Gabriel Piraccini. Final submission, 28 October 2026.

This page points to everything the final submission asks for. Each line links to where the evidence lives.

## Try it

- **Application:** https://fseproject-staging.vercel.app. Backup with the same code: https://fintwin-global.vercel.app.
- **Access:** open `/register` and create an account with any address and a 15–128 character passphrase. No email is sent, and there is no shared account.
- **What to try:** a new account starts empty.
  1. On **Cash events**, add an account and a few dated income and expense events. Setting **Repeat** to Monthly is the quickest way to add payroll or rent.
  2. Open the **Liquidity overview** to see the forecast.
  3. In the **Scenario lab**, delay an invoice and compare the scenario with the base.
  4. Set your own danger threshold on the **Workspace** page.
- Deployments, environments and how they are built: [deployment](docs/deployment.md).

## Code and collaboration

- **Repository:** https://github.com/spqrcode/fseproject
- **Merged pull requests with their reviews:** https://github.com/spqrcode/fseproject/pulls?q=is%3Apr+is%3Amerged. As of 27 October there are 32 merged pull requests. Every member authored pull requests and reviewed the others' work.
- **CI runs:** https://github.com/spqrcode/fseproject/actions
- **How we work:** [Git workflow](docs/git-workflow.md). `main` is protected: a pull request, one approval and a passing `verify` check.

| Member | Area |
| --- | --- |
| Bastian Bundschuh | Foundation and security: accounts, sessions, migrations, the restricted database role, CI, repeating cash events |
| Haina Liu | Forecast Engine: Decimal and money rules, daily projection, runway, input adapter, the user-set danger threshold |
| Jiaxin Huang | Scenarios and exchange rates: ECB snapshots, FX shocks, delayed-invoice scenarios, base versus scenario comparison, reporting-currency conversion, demo data |
| Gabriel Piraccini | Product experience: interface, design system, formatting, accessibility, home page, Vercel deployment |

## Where each required topic is documented

| Topic from the course checklist | Document |
| --- | --- |
| Project objective and finance use case | [README](README.md), [business metrics](docs/business-metrics.md) |
| Implemented features, user stories and acceptance criteria | [requirements](docs/requirements.md) (with a traceability table from story to code and tests), [product experience](docs/product-experience.md) |
| Architecture and technology stack | [architecture](docs/architecture.md) (component diagram, implemented vs planned) |
| Data model | [database](docs/database.md) (entity-relationship diagram) |
| External API integration and its failures | [architecture](docs/architecture.md), [decisions](docs/decisions.md) (ECB snapshots, CURRENT, STALE and UNAVAILABLE) |
| Testing and quality strategy | [testing](docs/testing.md) |
| Security considerations | [security](docs/security.md) |
| Git and development workflow | [Git workflow](docs/git-workflow.md) |
| CI/CD pipeline | [testing](docs/testing.md), [Git workflow](docs/git-workflow.md), `.github/workflows/ci.yml` |
| Deployment | [deployment](docs/deployment.md) |
| Agentic AI usage and relevant AI interactions | [AI usage](docs/ai-usage.md), agent rules in [CLAUDE.md](CLAUDE.md) |
| Engineering decisions and their rationale | [decisions](docs/decisions.md) |
| Known limitations and feature ideas | [limitations](docs/limitations.md) |
| Reflection: what would change for a real financial institution | [limitations](docs/limitations.md#reflection-what-must-change-before-real-financial-use), "Reflection" |
| Feedback from the presentation | [presentation feedback](docs/presentation-feedback.md), with a decision and evidence per item |
| Business view: how liquidity and user impact are measured | [business metrics](docs/business-metrics.md) |

## Test evidence

The CI run on `main` after the last code change was [run 40478418295](https://github.com/spqrcode/fseproject/actions/runs/40478418295) on commit `54694f7`; later merges changed documentation only. It passed:

- ESLint with zero warnings, strict TypeScript, and a production build.
- 378 unit tests.
- 237 database integration tests against PostgreSQL 16. One test is skipped by design: it checks the runtime role's privileges and runs only in the runtime step.
- The data-store integration tests run a second time with the application connected as the restricted role `fse_runtime`: 108 tests.
- 42 browser tests on the production build, including WCAG 2.2 AA checks in light and dark mode.

Run everything locally with `npm run verify` (setup in the [README](README.md)).

## One feature from requirement to deployment: repeating cash events

1. **Requirement.** At the presentation on 17 October, the professor noted that recurring expenses were mentioned but not realised. This is feedback #9 in [presentation feedback](docs/presentation-feedback.md).
2. **Decision.** The team chose a simple repeat, recorded in the feedback log in PR #34. It creates one ordinary event per occurrence, so the Forecast Engine, forecast input and scenarios stay unchanged. Open-ended repeats are a documented limitation.
3. **Specification.** The acceptance criterion was added to US-11 in [requirements](docs/requirements.md), with a traceability row.
4. **Implementation.** PR #35, by Bastian, changes these files:
   - `src/lib/recurring-dates.ts`
   - repeat schemas in `src/lib/validation.ts`
   - `createCashEvents` in `src/lib/cash-events-store.ts`, an atomic insert with the same session-to-account ownership chain
   - the Repeat fields in the cash-event form
5. **Tests.**
   - Unit tests for month ends, 29 February, year changes and the 60-occurrence limit.
   - Integration tests for ownership, invalid input and anonymous or unknown sessions.
6. **Review and CI.** Haina reviewed and approved it. Its first CI run exposed an order-dependent demo-seed test, which was fixed separately in PR #36. #35's CI then passed.
7. **Deployment.** The merge `ff36bbc` reached `main`. The backup deployment is rebuilt from `main` after a mirror sync, and staging is moved to the newest build of `main` after each merge (see [deployment](docs/deployment.md)).
