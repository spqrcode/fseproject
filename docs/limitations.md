# Limitations

## Current application

Issue 1 provides account/session handling and the existing portfolio setup UI. Holdings, stock quotes, valuations, P/L, and analytics are not implemented. Passing foundation tests does not mean the whole course specification is complete.

Email addresses are not verified. Password recovery, MFA, compromised-password screening, network-level abuse protection, and session housekeeping are absent. Per-address throttling can lock out a targeted address temporarily and does not stop attackers rotating addresses.

Authorization is enforced by the application, not database row-level policies. Production backup/restore exercises, audit logging, complete CSP, load testing, and independent security review remain future work. Hosted database/Vercel availability and quotas affect staging; no unconditional zero-cost or availability guarantee is made.

## Cash events

A cash event's status can only move once, from `expected` to `received`, `paid` or `cancelled`. There is no undo or reopening. Settled events (received, paid, cancelled) can be neither edited nor deleted, because they feed the forecast's starting balance; a correction is made by entering a new event (for example an opposite amount). Only `expected` events can be edited or deleted. Marking a future-dated event `received` or `paid` moves its date to today (UTC) and the planned date is not kept; this keeps the forecast's starting balance complete. The order is enforced by the application, not by a database trigger, so a privileged connection could still bypass it. Accounts cannot be deleted, and an account's currency and opening balance cannot be edited after creation. Account names are case-sensitive. Amounts have at most two decimals and dates must lie between 2000 and 2100.

## Forecast input

`getForecastInput` serves one account in one currency; there is no combined view across accounts or currencies yet. Forecasts cover at most 366 dates, counting both the first and the last day, between 2000 and 2100. The starting balance can be negative; the forecast engine (PR #12) accepts that and uses the workspace's danger threshold when one is set. The Liquidity overview calls the engine through `src/lib/liquidity-forecast.ts` (store, then the adapter of PR #19, then `runForecast`).

## Liquidity overview

One account at a time, in that account's own currency: amounts are not converted into the reporting currency yet, and the page says so. The workspace danger threshold is an amount in the reporting currency (decision 2 of 2026-10-08) but is applied unconverted to an account in another currency; the page says this too. Both are fixed by the later FX integration layer. Chart coordinates use floating point for pixel positions only; every amount shown as text is formatted from the exact decimal string. The forecast always starts on today's UTC date.

## Exchange rates

The ECB cache refreshes only when application code requests a rate; there is no background scheduler. A fetched snapshot is considered CURRENT for one hour. If ECB is unavailable after that, the latest validated observation may be returned indefinitely as STALE, but its status and effective date remain explicit. The UI must not present STALE as live, and UNAVAILABLE has no numeric fallback. Only EUR, USD and SGD are supported. Cross-rates require both ECB legs to have the same effective date. Provider corrections create a new immutable snapshot id and preserve the prior row. A provider request can wait up to ten seconds, and concurrent requests after cache expiry are not yet coalesced, so several refreshes can occur together.

## Later financial scope

One portfolio per user, USD instruments, current positions and average purchase price. No transaction ledger, realized P/L, FX, dividends, fees, taxes, corporate-action accounting, trades, advice, or advanced risk models. Allocation and P/L contribution will be descriptive, not a complete measure of investment risk.

A real financial institution would need licensed data, reconciled accounting, reviewed financial methodology, stronger identity and access controls, monitoring, incident response, tested recovery, and legal/compliance assessment for its jurisdiction and use.
