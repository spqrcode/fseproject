# Forecast Engine working draft

Status: technical foundation implemented on `haina`; cash-flow business rules require team review before implementation. This document records questions and test examples, not accepted product requirements.

## Boundary

The forecast module is a pure TypeScript domain layer under `src/lib/forecast`. It has no database, network, authentication, React, or Next.js dependency. Callers must supply validated domain input and explicit FX rates; UI components format results but do not calculate them.

The existing portfolio remains USD-instrument-only. Supporting EUR, USD, and SGD cash amounts in the forecast foundation does not by itself change the portfolio or quote-provider scope.

## Implemented technical foundation

- Amounts enter and leave the domain layer as plain decimal strings, never JavaScript numbers.
- `decimal.js` uses 40 significant digits and half-even rounding.
- Parsing rejects exponent notation, signs other than a leading minus, separators, surrounding whitespace, non-finite values, and leading zeroes such as `01`.
- Supported runtime currency codes are exactly `EUR`, `USD`, and `SGD`.
- Different currencies cannot be added, subtracted, or compared without conversion.
- An FX rate means quote-currency units per one base-currency unit. A matching direct rate multiplies; the reciprocal direction divides.
- Conversion keeps calculation precision. Rounding is a separate explicit operation and is not applied automatically.
- Cross-rate lookup is not implemented. A caller currently supplies one matching direct or reciprocal rate.

## Team decisions required

### Cash events

1. Does an event use a signed amount, or a positive amount plus `inflow`/`outflow` direction?
2. Are zero-value events invalid?
3. Are events before the forecast start rejected, ignored, or included in the opening balance?
4. Are events after the horizon rejected or ignored?
5. Are recurring events in scope? If so, which recurrence rules and end conditions are supported?
6. What is the deterministic order for multiple events on one date?
7. Is the balance recorded after every event or once per calendar day?
8. Which time zone defines a forecast date?

### FX

1. Does every forecast select one reporting currency?
2. Is one rate fixed for the complete forecast, or can rates vary by event date?
3. Are cross-rates allowed, and if so, which route is authoritative?
4. Does a missing or stale rate fail the complete forecast or produce a partial result?
5. How many digits may an input rate contain, and when is a converted amount settled to currency minor units?

### Minimum balance and runway

1. Does minimum balance include the opening balance?
2. For multiple events on one date, is the minimum measured intraday or only after the daily total?
3. If the same minimum occurs more than once, is the first date, last date, or every date returned?
4. Is liquidity exhausted when balance is below zero or when it is equal to zero?
5. If exhaustion is outside the horizon, should the result be `beyond-horizon`, `null`, or another explicit state?
6. Are runway days calendar-day differences or inclusive forecast days?

### Base and scenario contribution

1. Can a scenario add, remove, move, or resize events and change FX rates?
2. Is contribution measured against ending balance, minimum balance, runway, or several metrics?
3. When changes interact, is contribution assigned by a fixed incremental order or another attribution method?
4. Must individual contributions add exactly to the scenario-minus-base difference?

## Examples awaiting expected outcomes

| Scenario | Example | Decision needed |
| --- | --- | --- |
| Same-day inflow and outflow | Opening 100; +100 and -250 on one date | Event order and intraday minimum |
| Balance reaches zero | Opening 100; -100 | Whether zero exhausts liquidity |
| Repeated minimum | Balance reaches -20 on two dates | Which date or dates to return |
| Event before start | Event dated one day before forecast | Reject, ignore, or opening-balance treatment |
| Missing cross-rate | SGD event, EUR reporting, only USD pairs available | Error, cross conversion, or partial result |
| Scenario changes two events | One expense removed and another delayed | Contribution attribution order |

## Planned implementation after review

1. Define `CashEvent`, `ForecastInput`, `ForecastPoint`, `ForecastResult`, and scenario contracts.
2. Validate and normalize cash events without mutating caller input.
3. Project an ordered balance timeline in one reporting currency.
4. Derive minimum projected balance and liquidity runway from that timeline.
5. Calculate base-versus-scenario differences and reconcile contributions.
6. Add focused domain tests for every accepted rule and boundary.

## Out of scope until explicitly agreed

- Fetching live or historical FX rates.
- Guessing cross-rate routes.
- Database schema or persistence for forecasts.
- UI design and formatting.
- Recurrence syntax, interpolation between dates, or probabilistic forecasting.
