# Presentation feedback and decisions

Presentation: 17 October 2026. Final submission: 28 October 2026.

This file is the evidence that feedback from the presentation was incorporated, or consciously rejected with a reason. Fill it in during and immediately after the session; do not reconstruct it later.

## How to use

1. During the Q&A, one team member writes down every question, criticism and suggestion verbatim, with who raised it.
2. Within one day, the team decides for each item: **implement**, **document as a limitation**, or **reject with a reason**.
3. For every implemented item, link the pull request, the test or the document that shows the change. Re-run `npm run verify` and the deployed checks after the last change.
4. Before 28 October, every row has a decision and, where it was implemented, evidence.

## Feedback log

| # | Feedback (verbatim or close) | Raised by | Date | Decision | Reason | Evidence (PR, test, document) | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |

Decision values: `implement`, `limitation`, `reject`. Status values: `open`, `done`, `verified on deployed app`.

## Weaknesses we will state ourselves

Raising these before being asked is part of the assessment ("candid discussion of weaknesses and trade-offs"). Review and update this list before 17 October so it matches the deployed application.

| Weakness | Where it is documented | Planned or accepted |
| --- | --- | --- |
| A forecast uses one persisted ECB rate for its whole horizon, so future exchange-rate moves are not modelled, and FX shocks are not yet part of the base-versus-scenario comparison | [limitations](limitations.md), PRs #26 and #30 | Accepted for the prototype; shocks are previewed separately |
| The ECB cache refreshes only when a rate is requested; there is no scheduler, and concurrent refreshes are not coalesced | [limitations](limitations.md) | Accepted for the prototype |
| Email is not verified and there is no password recovery or MFA | [security](security.md) | Accepted, listed in the reflection |
| Authorization is in application queries and composite foreign keys, not database row-level security | [limitations](limitations.md) | Accepted, listed in the reflection |
| Preview deployments can be blocked when a commit author is not linked to the Vercel team | [deployment](deployment.md) | Account linking and team membership |
| The demo data is seeded by a script for a user registered in the browser, not a shared account, and its dates are relative to the seeding day | README, Demo data (PR #28) | Accepted: no credentials are committed; seed on the day of the demo or the day before |

## Defense answer pattern

We needed **X** because of requirement **Y**. We considered **A** and **B**. We selected **A** because **...**. The main trade-off is **...**. We verified it through **...**. The remaining limitation is **...**.

## Decisions worth defending

Pick three before the presentation and make sure every member can answer for each.

| Decision | Requirement | Alternative | Trade-off | Where |
| --- | --- | --- | --- | --- |
| Pure Decimal-based forecast engine, separate from storage and UI | Reproducible, testable numbers | Calculate in SQL or in components | An adapter layer is needed | [architecture](architecture.md), [forecast engine](forecast-engine.md) |
| Persisted, labelled ECB snapshots instead of live rates | Auditable results, resilience to API failure | Call the API on every render | Data can be stale; it is labelled | [database](database.md), [limitations](limitations.md) |
| Scenarios store adjustments, not copies of base events | Scenario isolation | Copy all events per scenario | A join is needed to resolve a scenario | [database](database.md) |
