# Forecast Engine working draft

Status: the Decimal/Money/FX foundation was merged in PR #8. Validated cash events and deterministic daily projection are implemented on `feat/haina-cash-projection`; Scenario and provider integration remain separate work.

## Boundary

The forecast module is a pure TypeScript domain layer under `src/lib/forecast`. It has no database, network, authentication, React, or Next.js dependency. Callers must supply validated domain input and explicit FX rates; UI components format results but do not calculate them.

## Implemented technical foundation

- Amounts enter and leave the domain layer as plain decimal strings, never JavaScript numbers.
- `decimal.js` uses 40 significant digits and half-even rounding.
- Parsing rejects exponent notation, signs other than a leading minus, separators, surrounding whitespace, non-finite values, and leading zeroes such as `01`.
- Supported runtime currency codes are exactly `EUR`, `USD`, and `SGD`.
- Different currencies cannot be added, subtracted, or compared without conversion.
- An FX rate means quote-currency units per one base-currency unit. A matching direct rate multiplies; the reciprocal direction divides.
- Conversion keeps calculation precision. Rounding is a separate explicit operation and is not applied automatically.
- Cross-rate lookup is not implemented. A caller currently supplies one matching direct or reciprocal rate.

## Decided forecast rules

### Cash events and dates

- Amounts are signed decimal strings: income is positive, expense is negative, and zero is invalid.
- Statuses match migration 005: `expected`, `received`, `paid`, and `cancelled`. Only `expected` events affect a projection; the other statuses are excluded.
- The Store/Input layer supplies the starting balance by combining account opening balances with settled `received` and `paid` events up to the forecast start. The Forecast Engine does not query persistence or add settled events again.
- Forecast dates are real `YYYY-MM-DD` calendar dates interpreted in UTC. Both `startDate` and `endDate` are inclusive. An overdue `expected` event before `startDate` is applied on `startDate`; an event after `endDate` is ignored.
- The timeline contains one end-of-day balance for every calendar date in the range.
- Events on the same date are ordered by canonical creation time. Equal timestamps put expenses before income, then use the event ID as a stable final tie-breaker. Because the current timeline records only end-of-day balances, this order does not change the reported daily minimum; it preserves deterministic arithmetic and a future intraday extension.
- A forecast contains at most 366 inclusive calendar dates so one request cannot create an unbounded server-side loop.
- Recurring-event expansion is not part of the current contract.

### Minimum balance and runway

- Minimum balance includes the opening balance and uses the first date when a repeated minimum is reached.
- `dangerThreshold` is a workspace amount in the reporting currency. When it is `null`, the engine defaults to 50% of opening balance. Both paths use Decimal without settlement rounding.
- A warning is triggered only when the end-of-day balance is strictly below the threshold; equality does not trigger it.
- Runway is the number of calendar days from `startDate` to the first warning date. It is `0` when breached on the first day and `null` when not breached within the horizon.
- Negative opening balances are accepted. With the default percentage threshold, an opening overdraft produces an immediate warning on the first forecast day; callers can supply an explicit workspace threshold instead.

### Scenario boundary

- Scenario application copies events and applies overrides without mutating persisted cash events or the base forecast.
- Phase 1 contribution delta is scenario closing balance minus base closing balance in the same reporting currency.

### FX observations

- Each forecast has one reporting currency: EUR, USD, or SGD.
- The FX service owns ECB fetching, caching, freshness and EUR-derived cross-rates. The Forecast Engine will receive resolved decimal `FxRate` values and fail explicitly when a required pair is missing.
- When the effective-date observation is unavailable, the provider layer selects the newest usable earlier snapshot and reports its effective date and freshness state; the Forecast Engine does not fetch or invent rates.

## Team decisions still required

### FX

1. What age changes a cached snapshot from current to stale, and when must a forecast become unavailable?
2. When, if ever, is a converted amount settled to currency minor units rather than kept at calculation precision?

### Base and scenario contribution

1. Beyond delayed dates and FX shocks, can a scenario add, remove, or resize events?
2. When several changes interact, what attribution order produces the contribution breakdown?
3. Must individual contributions add exactly to the scenario-minus-base closing-balance difference?

## Examples awaiting expected outcomes

| Scenario | Example | Decision needed |
| --- | --- | --- |
| Same-day inflow and outflow | Opening 100; +100 and -250 on one date | One end-of-day balance of -50; equal timestamps apply the expense first |
| Balance equals warning threshold | Threshold 50; ending balance 50 | No warning; the comparison is strictly below the threshold |
| Repeated minimum | Balance reaches -20 on two dates | Return the first date |
| Overdue expected event | Event dated one day before forecast | Apply it on `startDate` |
| Missing USD/SGD cross-rate | No resolved USD/SGD pair was supplied | Return an explicit missing-rate error |
| Scenario changes two events | One expense removed and another delayed | Contribution attribution order |

## Implementation status and next work

1. Implemented: `CashEvent`, `ForecastInput`, `ForecastPoint`, and `ForecastResult` contracts.
2. Implemented: immutable validation, daily balance timeline, overdue-event handling, workspace/default threshold, minimum balance, and runway.
3. Next: implement the agreed resolved-rate collection boundary with the ECB adapter owner.
4. Next: expose base-versus-scenario closing delta and reconcile the later contribution breakdown.
5. Next: connect the pure domain result to persistence and UI without moving calculations into those layers.

## Out of scope until explicitly agreed

- Fetching live or historical FX rates.
- Fetching or silently inventing fallback FX rates inside the Forecast Engine.
- Database schema or persistence for forecasts.
- UI design and formatting.
- Recurrence syntax, interpolation between dates, or probabilistic forecasting.
