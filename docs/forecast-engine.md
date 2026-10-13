# Forecast Engine

Status: the Decimal, Money and FX foundation (PR #8), deterministic cash projection (PR #12), database-to-engine adapter (PR #19), delayed-invoice projection, reporting-currency conversion (PR #26), and base-versus-scenario comparison (PR #23) are merged into `main`. The Liquidity overview and Scenario lab call the shared Forecast Engine path with real session-scoped data. PR #30 proposes expressing the comparison in the reporting currency; it remains under review and is not described as merged here.

## Boundary and data flow

The domain module under `src/lib/forecast` is pure TypeScript. It has no database, network, authentication, React or Next.js dependency. Server-side adapters own persistence, sessions and ECB access; UI components only format results.

```text
PostgreSQL + session
  -> getForecastInput
  -> toForecastInput
  -> FX rate service (only when currencies differ)
  -> convertForecastInput
  -> runForecast
  -> Liquidity overview

converted input + base result + delayed-invoice adjustments
  -> compareScenario
  -> Scenario lab
```

The Forecast Engine never fetches a rate and never invents a fallback. The FX service supplies one resolved `FxRate`; the pure conversion step converts the opening balance and every pending event before the engine runs.

## Decimal, Money and FX rules

- Amounts enter and leave the domain layer as plain decimal strings, never JavaScript numbers.
- `decimal.js` uses 40 significant digits and half-even rounding.
- Parsing rejects exponent notation, misplaced signs, separators, whitespace, non-finite values and invalid leading zeroes.
- Runtime currencies are exactly EUR, USD and SGD, matching the application allowlist.
- Money values in different currencies cannot be added, subtracted or compared before conversion.
- A rate is quote-currency units per one base-currency unit. Direct conversion multiplies and reciprocal conversion divides.
- The FX service owns ECB fetching, caching, freshness and EUR-derived USD/SGD cross-rates. The core `convertMoney` function only applies the matching rate it receives.
- Conversion retains calculation precision. Currency-minor-unit rounding happens only when values are displayed.
- A forecast uses one rate for its opening balance and all events. It does not attempt to predict future exchange rates.

## Forecast input rules

- Cash-event amounts are signed and non-zero: income is positive and expense is negative.
- The store returns only database events with status `expected`. Received and paid events dated on or before the start date are included in `startingBalance`; cancelled events appear nowhere.
- `toForecastInput` maps every returned expected event to the engine status `pending` and copies the account currency onto it. The engine also validates `completed` and `cancelled` inputs defensively, but neither affects a projection.
- Dates are real UTC `YYYY-MM-DD` calendar dates. `startDate` and `endDate` are inclusive.
- An overdue pending event is projected on `startDate`; an event after `endDate` is ignored.
- One forecast contains at most 366 inclusive dates between 2000 and 2100.
- Events on the same projected date are ordered by creation time, then expense before income for equal timestamps, then event ID. The order makes Decimal arithmetic deterministic.
- Inputs and their event objects are never mutated.

## Projection, threshold and runway

- The timeline contains one end-of-day balance for every date in the range.
- Minimum balance includes the opening balance and uses the first date when a repeated minimum is reached.
- `dangerThreshold` is an amount in the reporting currency. When it is `null`, the engine computes 50% of the opening balance without settlement rounding.
- A warning begins only when an end-of-day balance is strictly below the threshold; equality does not trigger it.
- Runway is the number of calendar days from `startDate` to the first warning date. It is `0` for a breach on the first day and `null` when no breach occurs in the horizon.
- A negative opening balance is valid. With the default threshold it warns on the first forecast day.

## Reporting-currency integration

`forecastStoredInReportingCurrency` connects the server-side input and FX services to the pure domain functions:

- If the account already uses the reporting currency, it runs the engine without an FX lookup.
- For a different currency, `getRate` returns a direct, reciprocal or EUR-derived cross-rate from persisted ECB snapshots.
- `convertForecastInput` converts the opening balance and all events with that one rate. The workspace threshold passes through because it is already stored in the reporting currency.
- `CURRENT` and `STALE` rates are both usable and visibly labelled with provider and effective date.
- When no usable snapshot exists, the result is `UNAVAILABLE`; the page shows no forecast rather than a wrong-currency or fabricated number.
- The current cache freshness window is one hour. If refresh fails, the latest validated older snapshot may be returned as `STALE`.

## Scenario boundary

- A delayed-invoice adjustment creates a new in-memory event list with a date override. It never changes the cash event or base forecast.
- Adjustments that no longer apply are reported as `invalid`, `not_applicable` or `not_in_forecast` instead of breaking the whole scenario.
- `scenarioContribution` is scenario closing balance minus base closing balance in the same currency.
- PR #23 supplies the side-by-side base/scenario result and an additive per-adjustment contribution breakdown. It checks that the contribution total equals the scenario-minus-base closing-balance difference instead of silently showing an inconsistent breakdown.
- The comparison currently runs in the selected account's currency. PR #30 proposes reusing `forecastStoredInReportingCurrency` so the Liquidity overview and Scenario lab use the same persisted ECB rate and both suppress figures when no usable rate exists.
- FX-shock provenance, freshness and percentage calculations remain owned by the FX/scenario modules; the Forecast Engine consumes only resolved rates and cash-event inputs.

## Verified boundary cases

| Case | Result |
| --- | --- |
| Same-day `+100` and `-250`, opening `100` | One end-of-day balance of `-50`; equal timestamps apply the expense first |
| Balance equals threshold | No warning; the comparison is strictly below |
| Repeated minimum | The first date is returned |
| Overdue expected event | Applied on `startDate` |
| 366 inclusive dates | Accepted |
| 367 inclusive dates | Rejected |
| Missing required FX rate | Explicit unavailable/error result; never zero or fallback |
| Negative opening balance with default threshold | Warning on the first forecast day |

On 2026-10-13, after updating the documentation branch through PR #23, `npm run check` passed ESLint, TypeScript, 335 unit tests and the Next.js production build. Database integration and browser validation remain recorded in the individual feature PRs and the final `npm run verify` run.

## Remaining work requiring team scope

- PR #30 must be reviewed and merged before the base-versus-scenario comparison can be described as using the workspace reporting currency.
- Saved FX shocks are displayed with provenance but are not yet applied to the base-versus-scenario cash-flow comparison.
- There is no combined forecast across several accounts. Adding one requires an agreed rule for combining accounts converted with different rates and effective dates; it is not silently assumed by the current engine.
- Scenarios that combine delayed events and FX shocks need an agreed attribution rule before individual contributions can claim to explain the total effect.
- Recurrence, interpolation, probabilistic forecasting and predicted future FX rates remain outside the agreed MVP.

## Deliberately outside the pure engine

- Database queries, session ownership and persistence of forecast results.
- ECB network access, caching and cross-rate discovery.
- UI design, formatting and minor-unit display rounding.
- Silent fallback values for missing data.
