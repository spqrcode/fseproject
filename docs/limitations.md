# Limitations

## Current application

The product is FinTwin Global, a multi-currency cash-flow and liquidity scenario tool. On `main`, account registration and sessions, workspaces, the Cash events page, forecast input for one account, the deterministic Forecast Engine, delayed-invoice scenarios, percentage FX shocks (preview and save), and the ECB exchange-rate snapshot cache are implemented. All three MVP views (Liquidity overview, Cash events, Scenario lab) are on `main`. Forecasts and the base-versus-scenario comparison are shown in the reporting currency (#23, #26, #30). Cash events can repeat monthly, quarterly or annually (#35), and the danger threshold can be set on the Workspace page (#37). The README status table lists the pull requests. Passing foundation tests does not mean the whole course specification is complete.

Email addresses are not verified. Password recovery, MFA, compromised-password screening, network-level abuse protection, and session housekeeping are absent. Per-address throttling can lock out a targeted address temporarily and does not stop attackers rotating addresses.

Authorization is enforced by the application, not database row-level policies. Production backup/restore exercises, audit logging, complete CSP, load testing, and independent security review remain future work. Hosted database/Vercel availability and quotas affect staging; no unconditional zero-cost or availability guarantee is made.

## Cash events

A cash event's status can only move once, from `expected` to `received`, `paid` or `cancelled`. There is no undo or reopening. Settled events (received, paid, cancelled) can be neither edited nor deleted, because they feed the forecast's starting balance; a correction is made by entering a new event (for example an opposite amount). Only `expected` events can be edited or deleted. Marking a future-dated event `received` or `paid` moves its date to today (UTC) and the planned date is not kept; this keeps the forecast's starting balance complete. The order is enforced by the application, not by a database trigger, so a privileged connection could still bypass it. Accounts cannot be deleted, and an account's currency and opening balance cannot be edited after creation. Account names are case-sensitive. Amounts have at most two decimals and dates must lie between 2000 and 2100.

A new event can repeat monthly, quarterly or annually, ending after a number of occurrences (2 to 60) or on an end date. This is a simple repeat, not a recurrence rule: FinTwin creates one ordinary event per occurrence on the same day of the month (a day a month does not have, such as the 31st or 29 February, moves to that month's last day). Each occurrence then has its own status and can be edited, settled or deleted on its own, and scenarios treat it like any other event. Open-ended repeats are not supported, because separate events need an end; an open-ended series would need a stored rule that the forecast input expands and that scenarios can reference, which is future work. There is also no "edit all future occurrences", no link between the occurrences, and no weekly repeat.

## Forecast input

`getForecastInput` serves one account in one currency; there is no combined view across accounts yet. Forecasts cover at most 366 dates, counting both the first and the last day, between 2000 and 2100. The starting balance can be negative; the forecast engine (PR #12) accepts that and uses the workspace's danger threshold when one is set. The Liquidity overview calls the engine through `src/lib/liquidity-forecast.ts` (store, then the adapter of PR #19, then `runForecast`).

## Liquidity overview

One account at a time, shown in the reporting currency: an account in another currency is converted with one persisted ECB rate for the whole forecast (#26), and the workspace danger threshold is compared in the reporting currency. The Scenario lab's base-versus-scenario comparison uses the same conversion. One rate per forecast means future exchange-rate moves are not modelled; that is what FX shocks are for, and shocks are not yet part of the comparison. Without a usable rate no figure is shown. Chart coordinates use floating point for pixel positions only; every amount shown as text is formatted from the exact decimal string. The forecast always starts on today's UTC date.

## Exchange rates

The ECB cache refreshes only when application code requests a rate; there is no background scheduler. A fetched snapshot is considered CURRENT for one hour. If ECB is unavailable after that, the latest validated observation may be returned indefinitely as STALE, but its status and effective date remain explicit. The UI must not present STALE as live, and UNAVAILABLE has no numeric fallback. Only EUR, USD and SGD are supported. Cross-rates require both ECB legs to have the same effective date. Provider corrections create a new immutable snapshot id and preserve the prior row. A provider request can wait up to ten seconds, and concurrent requests after cache expiry are not yet coalesced, so several refreshes can occur together.

## Feature ideas and decisions

Presentation feedback #11 (17 October 2026) asked us to document our feature ideas and decide for each whether it is built, planned or out of scope. "Planned" means an agreed next step after this submission, not work still due before it. Ideas mentioned in the proposal, the presentation or the docs are listed once here.

| Idea | Decision | Reason and evidence |
| --- | --- | --- |
| Delayed-invoice scenarios | Built | The most common liquidity risk for a small company, and its effect can be checked to the cent. PRs #9, #18, #22; US-12 |
| Base versus scenario comparison with a contribution per invoice | Built | Shows what a scenario changes without touching real data. PRs #23, #30; [business metrics](business-metrics.md) |
| Percentage FX shocks on a stored ECB rate | Built (preview and save) | Answers the cross-border risk from an auditable snapshot. PRs #17, #24; US-14 |
| Forecasts in one reporting currency | Built | One persisted ECB rate per forecast, nothing shown without a rate. PRs #26, #30 |
| Repeating cash events (monthly, quarterly, annually) | Built | Presentation feedback #9: payroll and rent repeat. One ordinary event per occurrence, so the engine and scenarios stay unchanged. PR #35 |
| A danger threshold the user can set | Built | Presentation feedback #7: the 50% default is an onboarding convention; a fixed amount can match a real buffer. PR #37; [decisions](decisions.md) of 26 October |
| Demo data for a registered user | Built | Repeatable presentation without shared credentials. PR #28 |
| FX shocks inside the base versus scenario comparison | Planned | Needs an attribution rule when a shock and a delay interact; today shocks are previewed and saved next to their ECB snapshot only |
| Per-invoice attribution of the timing impact (change in the lowest balance) | Planned | Today contributions explain the closing balance only; splitting the lowest-balance change depends on the order of interacting delays and needs an agreed rule. See [business metrics](business-metrics.md), known gaps |
| A combined view of all accounts | Planned | Needs an agreed rule for combining accounts converted at different rates and effective dates |
| Open-ended repeats, editing all future occurrences, weekly repeats | Planned | Needs a stored recurrence rule that the forecast input expands and scenarios can reference |
| Scheduled ECB refresh and coalesced concurrent refreshes | Planned | Today a rate is refreshed when it is requested, and its freshness is always labelled |
| Email verification, password recovery and MFA | Planned | Listed in [security](security.md) and in the reflection below |
| Database row-level security as a second authorization layer | Planned | Ownership is enforced by session-scoped queries and composite foreign keys today |
| More scenario types (for example an expense increase or a hypothetical one-off payment) | Rejected for this submission | Presentation feedback #10: polish existing features rather than add scenarios |
| Bank-statement import or open banking | Out of scope | Needs external credentials and a reconciliation model; manual entry is a stated limitation |
| Payment execution, financial advice, machine-learning or predicted exchange rates | Out of scope | Outside the purpose of a deterministic educational prototype |
| Holdings, market quotes and portfolio analytics | Removed | Belonged to the earlier portfolio version of the project, replaced after the group consultation |
| More currencies than EUR, USD and SGD | Out of scope for now | Adding one needs an ECB series, the currency allowlist and tests; three currencies keep the cases verifiable by hand |

## Reflection: what must change before real financial use

This is a teaching prototype that models liquidity; it does not hold or move money. Before an institution relied on it, these would have to change, roughly in order of importance.

1. **Data and methodology.** ECB euro reference rates are published once per working day and are not tradable rates. A treasury needs licensed intraday or contracted rates, a documented rate-selection rule, and a reviewed forecasting and stress methodology. The 50% default danger threshold is a convention, not a finding; the interface lets the user replace it with a fixed amount, but FinTwin does not determine the right buffer for the business.
2. **Source of truth.** Cash events are typed in by hand. A real system reconciles them against bank statements or an accounting ledger, handles partial payments, multiple legal entities and open-ended recurrence, and keeps an audit trail of every change. Here a settled event cannot be edited and there is no audit log.
3. **Identity and access.** Email is not verified, there is no password recovery, MFA or SSO, and one user owns one workspace with no roles. An institution needs enterprise identity, role-based access, four-eyes approval for sensitive changes and session management under its own policy.
4. **Authorization depth.** Ownership is enforced by application queries and composite foreign keys, not by database row-level security. A second layer in the database would protect against a faulty query.
5. **Operations.** There is no background scheduler for rate refresh, no housekeeping of expired sessions, no monitoring or alerting, no tested backup and restore, and the staging database is a free-tier service. Production needs defined availability targets, incident response, secret rotation and recovery drills.
6. **Assurance.** Controls are covered by automated tests and a self-review; there has been no independent penetration test, load test or model validation. AI-assisted code was reviewed and tested by the team, but an institution would also require a documented policy for AI use and software supply-chain checks.
7. **Compliance.** Data protection, retention, regulatory reporting and the jurisdiction's rules for treasury tooling were not assessed. The product is deliberately not a regulated stress-testing or ALM system and gives no financial advice.

What would we keep? The separation of a pure Decimal-based forecast engine from storage and presentation, persisted and labelled exchange-rate snapshots instead of live prices, scenarios stored as adjustments rather than copies of the base data, and the habit of showing "unavailable" instead of inventing a number.

## Later financial scope

Not built and not planned for this prototype: open banking or bank-statement import, payment execution, tax or financial advice, machine-learning forecasting, bank-grade regulatory metrics, microservices, complex role hierarchies, and arbitrary (RRULE-style) recurrence rules. The simple monthly, quarterly and annual repeat described under Cash events exists; open-ended repeats of that kind are listed as planned above. Supported currencies are EUR, USD and SGD. Holdings, market quotes and portfolio analytics belong to the earlier portfolio version of the project and were removed; `/forecast` and `/portfolio` return 404.

The product is a treasury-oriented educational prototype, not a regulated stress-testing or asset-liability management system, and it does not give financial advice. What a real deployment would require is set out in the reflection above.
