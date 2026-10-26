# Limitations

## Current application

The product is FinTwin Global, a multi-currency cash-flow and liquidity scenario tool. On `main`, account registration and sessions, workspaces, the Cash events page, forecast input for one account, the deterministic Forecast Engine, the delayed-invoice scenario and percentage FX-shock data layer, and the ECB exchange-rate snapshot cache are implemented. All three business views are on `main`. Forecasts and the base-versus-scenario comparison are shown in the reporting currency (#23, #26, #30). Still in review: bounds and error messages for FX shock percentages (#24). The README status table lists the pull requests. Passing foundation tests does not mean the whole course specification is complete.

Email addresses are not verified. Password recovery, MFA, compromised-password screening, network-level abuse protection, and session housekeeping are absent. Per-address throttling can lock out a targeted address temporarily and does not stop attackers rotating addresses.

Authorization is enforced by the application, not database row-level policies. Production backup/restore exercises, audit logging, complete CSP, load testing, and independent security review remain future work. Hosted database/Vercel availability and quotas affect staging; no unconditional zero-cost or availability guarantee is made.

## Cash events

A cash event's status can only move once, from `expected` to `received`, `paid` or `cancelled`. There is no undo or reopening. Settled events (received, paid, cancelled) can be neither edited nor deleted, because they feed the forecast's starting balance; a correction is made by entering a new event (for example an opposite amount). Only `expected` events can be edited or deleted. Marking a future-dated event `received` or `paid` moves its date to today (UTC) and the planned date is not kept; this keeps the forecast's starting balance complete. The order is enforced by the application, not by a database trigger, so a privileged connection could still bypass it. Accounts cannot be deleted, and an account's currency and opening balance cannot be edited after creation. Account names are case-sensitive. Amounts have at most two decimals and dates must lie between 2000 and 2100.

A new event can repeat monthly, quarterly or annually, ending after a number of occurrences (2 to 60) or on an end date. This is a simple repeat, not a recurrence rule: FinTwin creates one ordinary event per occurrence on the same day of the month (a day a month does not have, such as the 31st or 29 February, moves to that month's last day). Each occurrence then has its own status and can be edited, settled or deleted on its own, and scenarios treat it like any other event. Open-ended repeats are not supported, because separate events need an end; an open-ended series would need a stored rule that the forecast input expands and that scenarios can reference, which is future work. There is also no "edit all future occurrences", no link between the occurrences, no weekly repeat, and at most 60 occurrences per repeat.

## Forecast input

`getForecastInput` serves one account in one currency; there is no combined view across accounts or currencies yet. Forecasts cover at most 366 dates, counting both the first and the last day, between 2000 and 2100. The starting balance can be negative; the forecast engine (PR #12) accepts that and uses the workspace's danger threshold when one is set. The Liquidity overview calls the engine through `src/lib/liquidity-forecast.ts` (store, then the adapter of PR #19, then `runForecast`).

## Liquidity overview

One account at a time, shown in the reporting currency: an account in another currency is converted with one persisted ECB rate for the whole forecast (#26), and the workspace danger threshold is compared in the reporting currency. The Scenario lab's base-versus-scenario comparison uses the same conversion. One rate per forecast means future exchange-rate moves are not modelled; that is what FX shocks are for, and shocks are not yet part of the comparison. Without a usable rate no figure is shown. Chart coordinates use floating point for pixel positions only; every amount shown as text is formatted from the exact decimal string. The forecast always starts on today's UTC date.

## Exchange rates

The ECB cache refreshes only when application code requests a rate; there is no background scheduler. A fetched snapshot is considered CURRENT for one hour. If ECB is unavailable after that, the latest validated observation may be returned indefinitely as STALE, but its status and effective date remain explicit. The UI must not present STALE as live, and UNAVAILABLE has no numeric fallback. Only EUR, USD and SGD are supported. Cross-rates require both ECB legs to have the same effective date. Provider corrections create a new immutable snapshot id and preserve the prior row. A provider request can wait up to ten seconds, and concurrent requests after cache expiry are not yet coalesced, so several refreshes can occur together.

## Reflection: what must change before real financial use

This is a teaching prototype that models liquidity; it does not hold or move money. Before an institution relied on it, these would have to change, roughly in order of importance.

1. **Data and methodology.** ECB euro reference rates are published once per working day and are not tradable rates. A treasury needs licensed intraday or contracted rates, a documented rate-selection rule, and a reviewed forecasting and stress methodology. The 50% default danger threshold is a convention, not a finding.
2. **Source of truth.** Cash events are typed in by hand. A real system reconciles them against bank statements or an accounting ledger, handles partial payments, multiple legal entities and recurrence, and keeps an audit trail of every change. Here a settled event cannot be edited and there is no audit log.
3. **Identity and access.** Email is not verified, there is no password recovery, MFA or SSO, and one user owns one workspace with no roles. An institution needs enterprise identity, role-based access, four-eyes approval for sensitive changes and session management under its own policy.
4. **Authorization depth.** Ownership is enforced by application queries and composite foreign keys, not by database row-level security. A second layer in the database would protect against a faulty query.
5. **Operations.** There is no background scheduler for rate refresh, no housekeeping of expired sessions, no monitoring or alerting, no tested backup and restore, and the staging database is a free-tier service. Production needs defined availability targets, incident response, secret rotation and recovery drills.
6. **Assurance.** Controls are covered by automated tests and a self-review; there has been no independent penetration test, load test or model validation. AI-assisted code was reviewed and tested by the team, but an institution would also require a documented policy for AI use and software supply-chain checks.
7. **Compliance.** Data protection, retention, regulatory reporting and the jurisdiction's rules for treasury tooling were not assessed. The product is deliberately not a regulated stress-testing or ALM system and gives no financial advice.

What would we keep? The separation of a pure Decimal-based forecast engine from storage and presentation, persisted and labelled exchange-rate snapshots instead of live prices, scenarios stored as adjustments rather than copies of the base data, and the habit of showing "unavailable" instead of inventing a number.

## Later financial scope

Not built and not planned for this prototype: open banking or bank-statement import, payment execution, tax or financial advice, machine-learning forecasting, bank-grade regulatory metrics, microservices, complex role hierarchies, and arbitrary recurrence rules (only the simple monthly, quarterly and annual repeat described under Cash events exists). Supported currencies are EUR, USD and SGD. Holdings, market quotes and portfolio analytics belong to the earlier portfolio version of the project and were removed; `/forecast` and `/portfolio` return 404.

The product is a treasury-oriented educational prototype, not a regulated stress-testing or asset-liability management system, and it does not give financial advice. What a real deployment would require is set out in the reflection above.

