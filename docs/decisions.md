# Engineering decisions

Foundation choices below are implemented and awaiting student review. Financial/API choices remain proposed.

| Decision | Why | Alternative | Accepted cost |
| --- | --- | --- | --- |
| One Next.js application with TypeScript | One deployable application and shared types | Separate frontend/backend | Framework coupling; server/client boundaries still need review |
| Application-managed accounts and PostgreSQL | Meets the requirement to own backend behavior without a hosted auth service | Managed authentication provider | Team must implement and test password hashing, sessions, revocation, and abuse controls |
| Central server-only data access with explicit ownership predicates | A simple authorization boundary that students can explain and test | PostgreSQL row-level security as an additional layer | Every operation must use this boundary; omitted predicates are a security defect |
| One portfolio per user initially | Small, complete management workflow | Multiple portfolios | Reduced functionality; schema can later relax the uniqueness constraint |
| USD instruments and current positions | Defensible valuation without FX or transaction accounting | Multi-currency ledger | No realized P/L or historical performance |
| Decimal financial arithmetic | Predictable decimal precision | Binary floating point throughout | Additional library and explicit conversion rules |
| Forecast money foundation uses `decimal.js` with 40 significant digits and half-even rounding | FX division needs a reviewed decimal implementation; JavaScript numbers and the dashboard's temporary scaled-integer helper are not sufficient | Extend the custom BigInt helper | New dependency; precision and rounding policy must remain explicit and tested |
| FX rates are directed (`base`/`quote`); reciprocal rates are explicit and USD/SGD crosses use same-date ECB euro legs | Prevents an ambiguous number or mixed-date observations from being treated as one rate | Infer direction or combine any latest legs | Callers must supply the required pair; a cross may be unavailable even when both legs exist |
| EUR, USD and SGD come from `REPORTING_CURRENCIES` as the single application allowlist | Prevents the UI and Forecast Engine from accepting different currencies | Maintain two equal arrays and test them | The domain currency set is coupled to the agreed reporting-currency scope |
| Cash forecasts use signed, non-zero `pending` inputs on inclusive UTC dates and record one end-of-day balance per date | Keeps persistence statuses outside the pure engine; the Input adapter performs the documented migration-005 mapping | Pass database statuses directly into the engine | Intraday liquidity changes are not represented; overdue pending inputs are moved to the first forecast day |
| Liquidity warning is the first end-of-day balance strictly below the workspace amount, defaulting to 50% of opening balance when unset | Uses migration 005's nullable `danger_threshold` while preserving a deterministic default | Fixed percentage only | A workspace threshold must be interpreted in the reporting currency; negative opening balances are accepted |
| Allocation and absolute P/L contribution (planned) | Matches the small tracker specification | Advanced risk models | Limited analytical scope |
| Server-side quote adapter | Keeps secrets private and isolates provider behavior | Direct browser requests | Server quota management and latency |

## Open decisions

- Node 24.x is selected for development, CI, and Vercel; dependencies are pinned in the lockfile.
- Compare quote providers using actual USD stock/ETF coverage, free/education quotas, freshness, symbol resolution, licensing, caching permissions, and assessment availability. Do not assume any provider offers real-time data for free.
- Define numeric precision, input bounds, quote expiry, request timeout, and refresh limits before their implementation.
- Node scrypt, `pg`, 24-hour database sessions, and per-address throttling are implemented. Recovery and email verification remain out of scope.
- Staging uses a dedicated Neon PostgreSQL host with provider authentication disabled; the application still uses direct pg/SQL and internal authentication. Vercel hosts only the application.
- Confirm available GitHub protections and hosting/database account limits.
- Define the FX stale-data cutoff and agree the attribution order for scenarios with several interacting changes. The FX service owns ECB-specific cross rates and supplies resolved decimal rates to the Forecast Engine.

## 2026-10-09 — ECB snapshots, freshness and cross-rates

The ECB adapter requests the latest daily EUR/USD and EUR/SGD observations from the official SDMX data API. Only validated observations are cached. One hour after a successful fetch, the service attempts a refresh: success produces `CURRENT`; failure with a cached observation produces `STALE`; failure without one produces `UNAVAILABLE` with a `null` rate. The result includes provider, snapshot id(s), effective date, fetch time and any refresh failure so Product Experience can render one internally consistent result.

Both direct observations are written atomically and older concurrent responses are not selected over a newer fetch. A repeated observation refreshes only `fetched_at`; an ECB correction creates a new immutable snapshot id, so a scenario that references the old id remains reproducible. Reciprocal pairs reuse the same snapshot metadata. USD/SGD is derived with Decimal arithmetic only when its EUR/USD and EUR/SGD legs have the same effective date; otherwise it is unavailable. Alternative: combine each pair's latest row regardless of date (rejected because the displayed cross-rate would represent no real ECB observation set). Accepted costs: the service may display an old but clearly labelled stale rate during a long outage; there is no background refresh; and concurrent requests may each start a provider refresh after the one-hour cache expires.

Tests: `tests/unit/fx/*` and `tests/integration/fx.test.ts`.

## Defense record for significant changes

In the relevant PR, record: problem solved; implementation; why chosen; alternatives; trade-offs; tests and results; migration/deployment steps. Explain architectural problems before changing the design, and update this document when the decision changes.

## Issue 1 — Remove the shared authentication lockout

Problem: 100 attempts from one caller could disable authentication for everyone. Decision: retain a PostgreSQL fixed-window counter per normalized email only, allowing 10 attempts per 15 minutes. Alternatives: a global cap (rejected for availability), external rate-limit infrastructure (unnecessary here), or trusted IP limits (requires a defined proxy trust boundary). Accepted trade-offs: targeted address lockout and rotating-address abuse remain possible. Tests cover concurrency, normalization, window expiry, independence, and more than 100 unrelated attempts.

## Issue 1 — Production-mode browser tests

A reusable dev server could point at a real development database and issue different cookies. Tests now force a separate `_test` database and start their own production server. This costs one build and server startup but verifies production Secure cookies, server actions, and persistence without reusing developer sessions.

## Issue 1 — Runtime and hosting

Node 24 is declared in `.nvmrc` and `engines.node: 24.x`; GitHub Actions reads `.nvmrc`. Vercel also uses the package engine range, as documented in [its Node runtime configuration](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). Patch updates are allowed for security maintenance. The existing Vercel `fseproject` project was verified as linked to `spqrcode/fseproject`; other projects are outside this task.

## Issue 1 — Deploy from Git only, not from the working tree

Problem: `vercel deploy` uploads the working directory, so `.gitignore` does not protect anything; a staging deployment shipped ignored credential files to a third party. Decision: staging is built by the GitHub integration from a pushed commit, and the staging alias points at a Git-source deployment. Alternatives: keep CLI deploys and rely on `.vercelignore` (rejected — one forgotten pattern is a credential leak), or keep secrets outside the project directory (helps, but does not remove the upload class). Accepted trade-off: publishing requires a commit and push, which is slower than a local deploy but produces the commit to CI to deployment chain the assessment expects. `.vercelignore` is retained as defence in depth. Verified by inspecting the deployment upload manifest and by the deployment source field reporting `git`.

## Product experience: reporting currency and shared formatting

Problem: FinTwin Global reports figures in more than one currency, and the overview, forecast and scenario pages must show amounts the same way. Decision: store one reporting currency per account as a column on `users`, grant the staging runtime role `UPDATE` on that column only, keep the list of offered codes in the application, and format every amount through `src/lib/format.ts` from decimal strings with a fixed `en-GB` locale and UTC timestamps.

Alternatives: a separate `user_preferences` table (cleaner if many preferences appear, but one more join and grant for a single value); `UPDATE` on the whole `users` table (rejected, the runtime role could then rewrite password hashes); an allowlist in a database `CHECK` (rejected for now, every new currency from the FX provider would need a migration; the database checks the ISO 4217 shape instead); formatting with JavaScript numbers or the viewer's locale (rejected, numbers lose digits on large amounts and server and browser output could differ).

Appearance: stored per account like the currency, rendered by the server as `data-theme`, with colour tokens switched in CSS. Alternatives: `localStorage` plus an inline script before paint (per browser only, and an inline script would need an exception in a future Content Security Policy); following the device only (no way to override it). Unlike the currency, the database checks the complete list, because these three values are defined by the interface itself.

Accessibility checks: axe-core through `@axe-core/playwright` inside the existing Playwright suite, so CI runs them with no extra job. Alternatives: Lighthouse (slower, one page at a time, scores rather than failures) or manual review only (not repeatable). Automated rules cover part of WCAG; the remaining keyboard and focus behaviour stays in the browser specs.

Fonts: self-hosted through pinned Fontsource npm packages instead of loading Google Fonts at runtime (no third-party requests from users' browsers) or `next/font/google` (downloads at build time, so builds fail without access to Google). The cost is three small dependencies and no automatic preload of font files.

Rounding on screen: half to even, the same rule as the forecast engine (`decimal.js` with `ROUND_HALF_EVEN`), through the `roundingMode` option of `Intl.NumberFormat`. The browser default is half away from zero, which would show 1.25 for an amount the engine rounds to 1.24. Alternative: let every caller round with the engine before formatting (rejected, one forgotten call puts two different cents on the same screen).

Currency list: EUR, USD and SGD, agreed at the team meeting on 2 October 2026, replacing the first list of EUR, USD, GBP, CHF and JPY. Three currencies keep the FX pairs and test cases small enough to verify by hand (EUR/USD, EUR/SGD and USD/SGD through the euro), and SGD carries the APAC use case in the proposal. Alternative: keep five or six currencies because ECB publishes all of them (rejected, every extra code multiplies the pairs the Forecast Engine and Scenarios & FX must test without serving the use case). Revisit only if the SGD rates cause problems.

Accepted trade-offs: a code removed from the application list falls back to EUR on display until a migration cleans stored values; the interface uses one number format for everyone; currency conversion does not exist until Scenarios & FX delivers it. Tests: `tests/unit/format.test.ts`, `tests/integration/preferences.test.ts`, `tests/e2e/navigation.spec.ts`. Migration 003 is additive and safe to apply before the application change.

## Product experience: additions beyond the agreed MVP

The agreed MVP for Product Experience was the FinTwin Global interface shell, shared formatting and the reporting currency. Three further features were added in the same pull request. Each one is in its own commit with its own tests, touches no financial calculation and no Forecast or Scenarios code, and can be reverted on its own if the team decides to keep the app smaller.

| Addition | Why it is in scope | What it costs |
| --- | --- | --- |
| Public home page (`/`) | The assessment requires a publicly reachable application. Before, the entry point redirected straight to sign-in, so a visitor could not see what the product does. The page also states which views are available and which are in development, so nothing is promised that does not exist. | One server page with no data access; signed-in users are redirected to `/dashboard`. Its copy must be kept honest as features land. |
| Active sessions and "sign out of other sessions" | US-01 already requires sessions that expire and can be revoked. This makes revocation available to the user for a shared or lost device and gives the authentication design something visible to defend. | One store module and one server action over the existing `sessions` table, using privileges the staging role already had; no new table or grant. |
| Appearance (light, dark or device) | Many people set their device to dark mode for comfort, for light sensitivity or to read at night, so a dashboard that ignores it is harder to use for them. By default the app simply follows the device; a saved choice follows the account to every browser. Turning every colour into a token for the dark palette is also what lets the automated WCAG contrast checks cover both themes. It reuses the reporting currency pattern, so it adds no new mechanism. | One additive migration (004) with a single-column grant, one action and the dark token set in `globals.css`. It is the easiest of the three to drop. |

Decision, confirmed at the team meeting on 2 October 2026: keep all three, because each supports an existing requirement (public reachability, session revocation, accessibility) rather than opening a new feature area. Dark mode in particular stays because it carries no calculation or data risk, is rendered by the server without a script, and is covered by the same contrast checks as the light theme. If scope has to shrink before submission, revert the appearance commit first, then the sessions commit; the home page should stay because it serves the public-reachability requirement.

## Workspace, cash accounts and cash events (migration 005)

Problem: the Cash events page, the forecast and the scenarios need one place for a user's accounts and planned income and expenses, and every row must be reachable only by its owner. Decisions:

- **Rename `portfolios` to `workspaces`.** The table already is "one named thing per user", and the product calls it a workspace. `RENAME` keeps data and grants; a copy would need a data migration and new grants. Cost: the old `portfolios_*` constraint names remain, and open branches that import `portfolio-store` must be rebased onto `workspace-store`.
- **Amounts with 2 decimals, `numeric(20,2)`.** 18 integer digits and cents are enough for EUR, USD and SGD, and the forecast engine accepts exactly the strings the application stores. The first draft in PR #9 used `numeric(19,4)`; four decimals would let amounts exist that no currency can settle. Cost: no sub-cent amounts; the application rejects extra decimals because PostgreSQL would round them silently.
- **Currency on the account, not on the event.** An event cannot disagree with its account, and a currency is changed in one place. The account currency is immutable so existing events keep their meaning. Alternative: a currency column per event (rejected, mixed currencies on one account would be possible).
- **Currency list as a database `CHECK`.** `cash_accounts.currency` allows only EUR, USD and SGD, as agreed on 2 October 2026. This differs from the reporting currency (migration 003), which only checks the three-letter shape. A new currency now needs a migration for this table; in return stored data cannot contain a code the forecast cannot convert.
- **Composite foreign key with `UNIQUE (id, workspace_id)`.** A plain foreign key on `account_id` would not stop an event from naming another workspace's account. Alternative: a trigger or application check only (rejected, a missed check is an isolation defect). Cost: one extra unique index per table.
- **Narrow, column-level grants** for the staging role, following migrations 003 and 004. Cost: a new editable column needs a new grant.
- **Status transitions in the application.** Only `expected` → `received`, `paid` or `cancelled`, with no undo; the database checks the sign rule and the value list. A trigger would also stop a privileged connection from breaking the order, but is harder to read and test. A wrong click on a settled event is corrected with a new event (see the 2026-10-08 entry).
- **Dates as `date`, read as text.** The `pg` driver turns a `date` into a local-time JavaScript `Date`, which in Frankfurt can show the previous day, so SQL formats it as `YYYY-MM-DD`. The application accepts 2000–2100 only.

Tests: `tests/integration/cash-events.test.ts`, `tests/unit/cash-validation.test.ts`.

## 2026-10-08 — Forecast integration: statuses, danger threshold, starting balance, overdue events, immutable settled events

Agreed by the team for connecting the cash events to the forecast engine. PR #12 implements the engine side of the nullable threshold and overdue-event rules; for the input side (decisions 1–4) see the 2026-10-10 entry below. Decision 5 is implemented in `src/lib/cash-events-store.ts`.

1. **Database statuses stay `expected`, `received`, `paid`, `cancelled`; an adapter maps them for the engine.** `expected` becomes `pending`, `received` and `paid` become `completed`, and `cancelled` events are not passed to the engine at all. Why: the stored statuses describe what happened to the money (income received, expense paid) and carry the sign rule in the database, while the engine only needs to know whether a movement is still ahead or already settled. The adapter keeps the engine independent of how events are stored. Alternative: store `pending` and `completed` (rejected, it would lose the received/paid distinction and the database could no longer check the sign against the status). Accepted cost: one more mapping to keep in sync; a fifth status would need an explicit decision in the adapter, so the mapping should be tested for every status.
2. **`danger_threshold` stays configurable per workspace; when it is null the engine uses 50% of the opening balance.** The adapter expresses the workspace amount and the combined opening balance in the selected reporting currency before calling the engine. Why: the user can set their own limit, and a new workspace still gets a useful warning with no setup. Alternative: require a threshold before any forecast (rejected, an empty first screen). Accepted cost: 50% is a convention, not a finding; a zero opening balance warns only after it becomes negative, while a negative opening balance is already below its default threshold and warns on the first forecast day. The default is computed, not stored, so changing the rule later changes the warnings for every workspace that never set a threshold.
3. **The store resolves the forecast's starting balance and passes it to the pure engine.** The starting balance is the account's opening balance plus its `received` and `paid` events dated before the forecast start. Why: the store is the only layer that reaches the database through the session, so ownership stays in one place, and the engine stays a pure function that can be tested with plain inputs. Alternative: give the engine all past events and let it compute the balance (rejected, it would then need data it should not see and a second copy of the ownership rules). Accepted cost: part of the financial rule now sits in a SQL query, which needs its own tests (events before, on and after the start date, per account and currency, and other users' rows).
4. **Overdue `expected` events are counted on the forecast start date and flagged as overdue for the UI.** An overdue event is an `expected` one dated before the forecast start. Why: the money has not moved yet, so it still affects future cash; dropping it would overstate or understate the balance, and keeping it on its old date would put it in the past of the forecast. Showing the flag lets the user mark it received, paid or cancelled. Alternative: ignore overdue events (rejected, silently wrong totals). Accepted cost: the start date is an assumption about when the overdue amount will really move, so it can show a low balance earlier than reality, and the flag must be visible or the shifted date will look like a data error.
5. **Settled events are immutable.** An event that is `received`, `paid` or `cancelled` can be neither edited nor deleted; only `expected` events can. Own settled events raise `StatusConflictError`, and another user's or a missing event is still `null`/`false`. Reason (review feedback from Jiaxin on PR #10): settled events feed the forecast's starting balance, so changing or removing one would silently change every forecast that starts after it. The status condition sits in the `WHERE` clause of the `UPDATE` and `DELETE`, so the check and the change are one atomic statement. Alternative: allow edits and rely on the user's care (rejected, history of money that has moved would become editable), or a database trigger (rejected for now, like the status order it is harder to read and test; a privileged connection can still bypass the rule). Accepted cost: a mistake in a settled event cannot be fixed in place; it is corrected with a new event, so the list keeps both. Tests: `tests/integration/cash-events.test.ts`.

## 2026-10-08 — Delayed-invoice scenarios are immutable workspace overlays

A delayed-invoice scenario stores a later date for one expected positive cash event; it never updates or copies the original event. The scenario calculation replaces the date only in a new in-memory event list, so the persisted event and base forecast remain unchanged. Alternatives: update the event and restore it later (rejected, concurrent users and failed requests could corrupt the base data), or copy every event into each scenario (rejected, duplicated data can drift).

Scenarios and events meet through composite `(id, workspace_id)` foreign keys. Application queries also start from the unexpired session and join through its workspace. The duplicated workspace column costs one UUID per adjustment but makes cross-workspace links impossible even if an ownership predicate is accidentally omitted. Only expected income can be delayed, and the new date must be strictly later; the eligibility check and insert are one SQL statement. Migration 006 remains reserved for FX snapshots and migration 007 owns scenarios and their adjustments.

### 2026-10-12 — An adjustment that cannot apply is skipped and reported, not thrown (review of PR #9)

**Decision.** `runScenarioForecast` applies only the adjustments that fit the forecast and returns the others in `skipped` with a reason: `invalid`, `not_applicable` (its event is no longer `expected`, or was edited so that it is no longer income or no longer earlier than the override) or `not_in_forecast` (its event is not in the account's event list). `getAdjustments` derives `not_applicable` when it reads; nothing is written. `applyDelayAdjustment` stays strict.

**Requirement.** A scenario must keep working when the events around it change (US-12, isolation) and must not hide a skipped assumption.

**Alternatives.** Throwing, the first version: one settled event, or an adjustment for another account's event, made the whole scenario fail. Writing a new status when an event is settled: needs a migration and a write on every settle. Dropping the adjustment silently: the person would not know an assumption was ignored.

**Reason and trade-off.** Scenarios belong to the workspace but a forecast belongs to one account, and events are settled after adjustments are saved, so "does not apply here" is normal, not an error. The cost is that callers must show `skipped`. The derived state costs one join on read and cannot go stale.

**Verification.** Unit tests for each reason and for purity; integration tests for adjustment → settle → scenario still runs, and for two accounts. Found by Bastian's review of #9.

## 2026-10-10 — Forecast input implemented; a settled event's date is the date the money moved

Implemented in `src/lib/forecast-input-store.ts` (`getForecastInput`) and `src/lib/forecast-input.ts` (`toEngineStatus`). Since PR #12 (engine) and PR #19 (`toForecastInput`) are merged, the store's output goes through `toForecastInput` into `runForecast`; an integration test in `tests/integration/forecast-input.test.ts` runs the whole path.

**Status of the 2026-10-08 decisions**
1. Status mapping: implemented as `toEngineStatus` (expected → pending, received and paid → completed, cancelled → excluded, checked for every status at compile time). The adapter from PR #19 marks every returned event `pending`; that is the same mapping, because the store only returns `expected` events.
2. Default danger threshold: the store returns the workspace value as stored (`null` when none is set). The 50% default belongs to the engine (PR #12) and is not applied by the store.
3. Starting balance: implemented, with one correction found in review (PR #14, 2026-10-11). It is the account's opening balance plus its `received` and `paid` events dated **on or before** the start date, summed by PostgreSQL in `numeric`. The first version used "before", which left money that moved on the start day in neither the balance nor the event list, because the engine ignores completed events. Decision 3 of 2026-10-08 is read as "on or before" from here on.
4. Overdue events: implemented as decided. An `expected` event dated before the start date is returned with `expectedDate` set to the start date, its stored date kept as `originalDate`, and `overdue: true`.

**Clarification of decision 3, and the answer to the gap it left.** An event that is `received` or `paid` and dated after the start date would be in neither the balance nor the event list, so its money would vanish from the forecast. Closed at the source, not with a second list: a settled event's date is the date the money moved. When `setCashEventStatus` marks an event `received` or `paid` and its date is after today, the same `UPDATE` sets the date to today. Today is `(now() AT TIME ZONE 'UTC')::date`, not `current_date`, which depends on the database session's time zone. Past-dated events keep their date, and `cancelled` never changes the date. Why: it keeps the rule for the starting balance simple (everything dated on or before the start has moved) and the rule is enforced in one place. Alternatives: count all settled events whatever their date (rejected by the team, the start date would stop mattering for settled events), or return the early-settled events in a separate list (rejected, the numbers would stay wrong until the interface showed the list). Accepted cost: the original planned date of an early-settled event is lost (settled events are immutable, so it cannot be restored); a forecast whose start lies in the past still sees events settled later as dated by when they were settled.

**Other choices.** Both queries run in one read-only `REPEATABLE READ` transaction, so an event that changes status in between cannot fall out of both the balance and the list; the connection is released in `finally`, and discarded if the transaction failed. The range is validated before the session is checked (valid dates between 2000 and 2100, start not after end, at most 366 dates counting both the first and the last day, because the engine loops per day and accepts at most 366 dates; a range from 2026-10-01 to 2027-10-01 is accepted, one day more is not). `createdAt` is formatted in SQL as UTC text with milliseconds and a `Z`, which avoids `Date` conversions.

**Integration points with PR #12, resolved** (PRs #12 and #19, merged 2026-10-11/12): the engine takes a nullable `dangerThreshold` and defaults to 50% of the opening balance; it accepts a negative opening balance, and with the default threshold an overdraft warns on the first forecast day; its events carry no `userId`, and `toForecastInput` copies the account currency onto each event.

Tests: `tests/integration/forecast-input.test.ts`, the settling tests in `tests/integration/cash-events.test.ts`, `tests/unit/forecast-input.test.ts`.

## 2026-10-12 — FX shocks: bounded percentage, and which rate a saved shock uses (review of PR #17)

**Bounded percentage.** A stored shock is a plain decimal from -99.99 to 100 with at most four decimals: `numeric(7,4)` and a range check in migration 009, and the same rule in `parseShockPercent`, which the preview and the save both use, so a value that can be previewed can also be saved. Why: the column was an unbounded `numeric` and the code only checked "> -100", so +5000% or a 40-digit value was accepted and would have produced a meaningless scenario. Trade-off: a hypothetical beyond +100% or below -99.99% cannot be entered. The database rounds silently to four decimals, so the application refuses more precise input instead of relying on that. For the same reason the migration refuses, rather than rounds, an existing saved shock that does not fit (review of #24): a saved scenario must never change without being edited.

**Two paths, one rule.** The preview (`getRate` → `buildScenarioFxResult`) takes the latest snapshot and reports `CURRENT`, `STALE` or `UNAVAILABLE`. A saved shock (`evaluateScenarioFxShock`) is evaluated against the snapshot it was saved with and has no freshness, because a snapshot is historical by definition. The Scenario Lab uses the preview to choose and the saved snapshot to compute, and shows the snapshot's pair, rate and ECB date next to every saved shock. Why: forecasts and scenarios consume persisted snapshots so that a result can be reproduced; re-pricing a saved shock against whatever ECB published last would change a scenario without anyone editing it. Alternative: re-evaluate against the latest rate each time (rejected: results move silently). Accepted cost: "USD −10%" keeps using its old rate until the person saves a new shock, so the ECB date must stay visible and a stale-looking date is the signal.

**Errors.** A second shock for the same scenario and snapshot is a `DuplicateFxShockError` (like `DuplicateDelayAdjustmentError` in #9), and an expired session reports "Authentication required." instead of "not found".

Tests: unit tests for the bounds, the duplicate and the expired session; integration tests that the database refuses the same values when the application is bypassed.

## 2026-10-12 — Forecasts in the reporting currency

**Decision.** An account's forecast is converted into the reporting currency before it is run: the opening balance and every event with one rate from the persisted ECB snapshots (through the rate service, so a fresh cache is used without a network call and at most one refresh is attempted per hour). The workspace danger threshold is not converted, because it is already an amount in the reporting currency (decision 2 of 2026-10-08). `CURRENT` and `STALE` rates are both used and labelled; with no usable rate the forecast is unavailable and no number is shown. Code: `convertForecastInput` (pure) and `getForecastInReportingCurrency` (server).

**Requirement.** US-06 (proposal): use EUR, USD or SGD as display currency, with a visible effective date, provider and data state. It also fixes the known limit that the threshold was compared in the account's own currency.

**Alternatives.** Convert each event with the rate of its own date: more realistic for settled history but makes a forecast a mix of rates that nobody can reproduce from one snapshot. Convert only the totals: the threshold and runway would still be computed in the wrong currency.

**Trade-off.** One rate for a whole forecast means the converted figures are the base figures scaled by that rate; it does not model future rate moves (that is what FX shocks are for).

**Verification.** Unit tests: no-op in the same currency, both directions of a pair, no rounding, the threshold passed through and changing the warning, a missing or wrong-pair rate refused, purity. PostgreSQL tests with a provider double: fresh cache without a provider call, the threshold in the reporting currency, the cross rate, STALE when the provider is down, unavailable without a rate, ownership.

