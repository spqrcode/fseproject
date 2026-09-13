# Testing strategy

Status: no executable tests or test tooling yet. This increment checks documentation only.

## Layers

- Vitest unit tests: financial calculations, numeric validation, and quote normalization.
- Database integration tests: real PostgreSQL constraints and application ownership enforcement using isolated test users and authenticated sessions.
- Server integration tests: authentication failures, invalid requests, persistence errors, and provider failure mapping.
- Playwright: account/session flow, portfolio and holding lifecycle, dashboard behavior, and persistence after reload.

Mock the external provider in repeatable CI tests. Add a separately recorded live-provider smoke check to establish that the real integration works. Mocked tests alone cannot prove provider compatibility. Use isolated test data and never run destructive tests against assessment data.

## Required cases

| Area | Cases |
| --- | --- |
| Arithmetic | Fractional quantities, decimal prices, gains/losses, multiple positions, rounding boundaries, empty portfolio, invalid values, undefined percentage |
| Completeness | Missing one/all quotes, mixed fresh/stale quotes, partial totals clearly labeled, no false full allocation |
| Ownership | Two users and anonymous access; read/create/update/delete; forged owner; foreign parent; parent reassignment |
| Persistence | Duplicate instrument, duplicate portfolio, invalid numeric constraints, reload after mutation, failed write |
| Market API | Timeout, disconnect, 429, 5xx, invalid JSON, wrong schema, wrong instrument/currency, nonpositive price, invalid timestamp, stale quote |
| Sessions | Invalid login, expired session, logout, direct protected route and server-operation access |
| User experience | Loading, empty, validation, failure, and recovery states; keyboard-accessible forms |

## Per-change completion

Run relevant tests, lint, TypeScript checks, and production build after the scaffold exists. Record actual commands, outcomes, and any skipped checks with reasons. Review security and verify affected acceptance criteria. Broaden tests when new changes or failures justify it.

Retain CI links, test reports, useful screenshots, and reviewer feedback. A passing unit suite does not establish database-backed authorization, deployment correctness, or complete end-to-end behavior.
