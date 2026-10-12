# Limitations

## Current application

Issue 1 provides account/session handling and the existing portfolio setup UI. Holdings, stock quotes, valuations, P/L, and analytics are not implemented. Passing foundation tests does not mean the whole course specification is complete.

Email addresses are not verified. Password recovery, MFA, compromised-password screening, network-level abuse protection, and session housekeeping are absent. Per-address throttling can lock out a targeted address temporarily and does not stop attackers rotating addresses.

Authorization is enforced by the application, not database row-level policies. Production backup/restore exercises, audit logging, complete CSP, load testing, and independent security review remain future work. Hosted database/Vercel availability and quotas affect staging; no unconditional zero-cost or availability guarantee is made.

## Cash events

A cash event's status can only move once, from `expected` to `received`, `paid` or `cancelled`. There is no undo or reopening. Settled events (received, paid, cancelled) can be neither edited nor deleted, because they feed the forecast's starting balance; a correction is made by entering a new event (for example an opposite amount). Only `expected` events can be edited or deleted. The order is enforced by the application, not by a database trigger, so a privileged connection could still bypass it. Accounts cannot be deleted, and an account's currency and opening balance cannot be edited after creation. Account names are case-sensitive. Amounts have at most two decimals and dates must lie between 2000 and 2100.

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

One portfolio per user, USD instruments, current positions and average purchase price. No transaction ledger, realized P/L, FX, dividends, fees, taxes, corporate-action accounting, trades, advice, or advanced risk models. Allocation and P/L contribution will be descriptive, not a complete measure of investment risk.

A real financial institution would need licensed data, reconciled accounting, reviewed financial methodology, stronger identity and access controls, monitoring, incident response, tested recovery, and legal/compliance assessment for its jurisdiction and use.
