# Portfolio Risk Dashboard

A university Financial Software Engineering project for a team of four students. Engineering quality, security, and explainable behavior take priority over feature count.

## Status

Documentation baseline only. No application, database, automated tests, CI workflow, or deployment exists yet. Controls described in these documents are planned unless accompanied by verification evidence.

## Planned scope

Authenticated users manage one portfolio containing stock/ETF positions with quantity and average purchase price. A server-side market-data integration supplies quotes for portfolio valuation, unrealized profit/loss, allocation, and concentration information.

Initial scope uses USD-denominated instruments only. Historical returns, volatility, and value-at-risk are excluded until reliable historical data and an agreed methodology exist.

Proposed stack: Next.js, TypeScript, application-managed authentication, PostgreSQL, Vercel, GitHub Actions, Vitest, and Playwright. Dependency versions and market-data provider remain to be verified during implementation.

## Documentation

- [Requirements and acceptance criteria](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Decisions and trade-offs](docs/decisions.md)
- [Testing](docs/testing.md)
- [Security](docs/security.md)
- [Deployment and collaboration](docs/deployment.md)
- [AI usage and review evidence](docs/ai-usage.md)
- [Limitations](docs/limitations.md)

## Incremental delivery

1. Review this baseline together and agree ownership of work.
2. Scaffold the application, testing tools, and CI on a feature branch; prove a clean build.
3. Implement authentication and protected navigation.
4. Add schema migrations, ownership checks, and database authorization tests.
5. Add portfolio and holding management with validation.
6. Add tested financial calculations.
7. Integrate market quotes with bounded requests and failure handling.
8. Add dashboard analytics, complete end-to-end tests, and deploy for assessment.

Each feature starts with a user story, acceptance criteria, implementation explanation, security implications, tests, and failure scenarios. Each change ends with validation results, security review, a proposed commit message, and documentation evidence. Do not claim a check passed unless it ran successfully.

## Local setup

Setup commands will be added and verified with the application scaffold. No credentials are needed for this documentation increment. Never commit secrets.
