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
| 1 | Using AI is fine and part of the project; the key requirement is transparency about how it was used | Sofie Sharaf (consultation) | 2026-10-13 | implement | The assessment rewards verified, documented AI use | [ai-usage](ai-usage.md): per-member summary and one entry per substantial change; agent rules in `CLAUDE.md` | done |
| 2 | The deployed app must be reachable by the professor without project-member access | Sofie Sharaf (consultation) | 2026-10-13 | implement | Accessibility is checked on presentation day | Public sign-in and registration, no shared account; checked signed out on 16 October; deployment criterion awarded 1 of 1 on 17 October | done |
| 3 | The professor needs source-code access, preferably on GitHub rather than a ZIP, to see the commit history | Sofie Sharaf (consultation) | 2026-10-13 | implement | Commit and review history is part of the evidence | Repository made public on 16 October; `main` protected (pull request, one approval, `verify` must pass) | done |
| 4 | Every member should understand the architecture, stack, key decisions and deployment, beyond their own part | Sofie Sharaf (consultation) | 2026-10-13 | implement | General questions can go to anyone | Cross-area reviews on every PR; team Q&A list; all four members presented | done |
| 5 | Show the target users and their needs, and explain why some scenarios were prioritised | Sofie Sharaf (consultation) | 2026-10-13 | implement | The use case was well defined but not on the slides | Presentation: target-user and scenario-prioritisation slides | done |
| 6 | For the final submission, possibly add one or two more scenarios | Sofie Sharaf (consultation) | 2026-10-13 | reject | Superseded by #10: after seeing the demo, the recommendation is to polish existing features instead | See #10 | done |
| 7 | The reasoning for the danger threshold is not properly backed: why this threshold? | Sofie Sharaf (presentation) | 2026-10-17 | implement | The fixed 50% default is a convention, and users cannot change it in the interface although the backend supports it | Planned: a business rationale for the default in [decisions](decisions.md) and a threshold setting on the Workspace page, with tests | open |
| 8 | Define the "business view" better, for example how user impact is measured | Sofie Sharaf (presentation) | 2026-10-17 | implement | Our metrics (lowest balance, first day below the threshold, runway, scenario difference) are computed but not defined as business measures | Planned: a business-metrics section in [requirements](requirements.md) that defines each measure and the question it answers | open |
| 9 | Some ideas felt not fully realised, e.g. recurring expenses and the danger threshold | Sofie Sharaf (presentation) | 2026-10-17 | to decide by 20 October | Threshold: covered by #7. Recurring expenses: decide between a simple monthly recurrence and a documented limitation, depending on effort | Team decision recorded here | open |
| 10 | Polish the application on the feature side rather than adding more scenarios; the architecture is strong as it is | Sofie Sharaf (presentation) | 2026-10-17 | implement | Depth of existing features is valued over breadth | No new scenario types before 28 October; remaining work limited to #7–#9 and #11 | done |
| 11 | Document the feature ideas and re-evaluate whether existing features can reach their full potential | Sofie Sharaf (presentation) | 2026-10-17 | implement | Ideas that are mentioned should be traceable to a decision | Planned: a feature-ideas section in [limitations](limitations.md) with a decision per idea (built, planned, out of scope) | open |

Decision values: `implement`, `limitation`, `reject`. Status values: `open`, `done`, `verified on deployed app`.

Presentation result on 17 October: 10 of 10 points (assessment sheet). Noted strengths: reflection on AI usage, architecture models and test cases, preparation. Noted weakness: the reasoning behind some modelling decisions, in particular the danger threshold.

## Plan until the final submission on 28 October

| Item | Feedback rows | Owner | Target |
| --- | --- | --- | --- |
| Danger threshold: business rationale for the default, setting on the Workspace page, tests | 7, 9 | to be agreed | 23 October |
| Business metrics: definition of each measure and how scenario impact is measured | 8 | to be agreed | 21 October |
| Recurring expenses: decision, then either a simple monthly recurrence or a documented limitation | 9 | to be agreed | decision 20 October |
| Feature ideas: one table with a decision per idea | 11 | to be agreed | 24 October |
| Final pass: `npm run verify`, deployed checks, status of every row above | all | all | 27 October |

## Weaknesses we will state ourselves

Raising these before being asked is part of the assessment ("candid discussion of weaknesses and trade-offs"). Review and update this list before 17 October so it matches the deployed application.

| Weakness | Where it is documented | Planned or accepted |
| --- | --- | --- |
| A forecast uses one persisted ECB rate for its whole horizon, so future exchange-rate moves are not modelled, and FX shocks are not yet part of the base-versus-scenario comparison | [limitations](limitations.md), PRs #26 and #30 | Accepted for the prototype; shocks are previewed separately |
| The ECB cache refreshes only when a rate is requested; there is no scheduler, and concurrent refreshes are not coalesced | [limitations](limitations.md) | Accepted for the prototype |
| Email is not verified and there is no password recovery or MFA | [security](security.md) | Accepted, listed in the reflection |
| Authorization is in application queries and composite foreign keys, not database row-level security | [limitations](limitations.md) | Accepted, listed in the reflection |
| Preview deployments can be blocked when a commit author is not linked to the Vercel team | [deployment](deployment.md) | Account linking and team membership |
| The danger threshold defaults to 50% of today's balance and cannot yet be changed in the interface, although the backend stores a workspace threshold | [limitations](limitations.md) | Planned for the final submission (feedback #7) |
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
