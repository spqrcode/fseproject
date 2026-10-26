# Business metrics: how FinTwin measures liquidity and user impact

Presentation feedback #8 (17 October 2026) asked us to define the "business view": what each number on the screen means for the user, and how the impact of a scenario is measured. This document gives that definition. It describes what the code on `main` computes; where a measure has a known gap, the gap is stated.

## Who the numbers are for

The user is the finance lead or founder of a small company with cash flows in EUR, USD and SGD. They ask four questions, and every measure below answers one of them:

1. Where do we stand today?
2. Will cash run short in the coming weeks, and when?
3. How much time do we have to act?
4. What does a late payment or a currency move do to that answer?

All measures are computed per account, in the workspace's reporting currency, from today's opening balance and the end-of-day balances over the chosen horizon (30, 90, 180 or 365 days). The calculation is deterministic: the same events and the same stored exchange rate always give the same numbers.

## Base forecast measures

| Measure (screen label) | Definition | Code field | Question it answers |
| --- | --- | --- | --- |
| Balance today | Opening balance of the account plus all received and paid events dated on or before today | `openingBalance` | Where do we stand today? |
| Lowest balance, with its date | The minimum of the opening balance and all end-of-day balances in the horizon. The opening balance is taken before today's expected events, so the minimum can be lower than every end-of-day point. If the opening balance is the minimum, the date is the start date; if a value occurs more than once, the first date | `minimumBalance`, `minimumDate` | What is the tightest point, and when? |
| Balance at the end of the horizon | End-of-day balance on the last date | `closingBalance` | Where do we end up? |
| Danger threshold | The minimum cash the company wants to keep: an amount set for the workspace, or by default 50% of today's balance | `dangerThresholdAmount`, `dangerThresholdPercent` | What is "too little cash" for us? |
| First day below the threshold | The first date whose end-of-day balance is strictly below the threshold | `firstDangerDate` | When do we have to act? |
| Runway | Calendar days from today to the first day below the threshold; shown as "N+ days" when that does not happen within the horizon | `runwayDays` | How much time do we have? |

**Why the lowest balance leads, not the closing balance.** Small-company cash flow is lumpy: payroll and rent leave on fixed dates, invoices arrive late. A forecast can end higher than it started and still dip below a safe level in between. The closing balance hides that dip; the lowest balance and the first day below the threshold show it. That is why the overview shows the lowest balance right after today's balance, and the closing balance after it.

**Why our runway is event-based.** The common startup definition is cash divided by monthly burn rate. It assumes spending is steady. Our users' spending is not, so we count the days until the projected balance actually falls below the threshold, using the dated events themselves. The trade-off: the result depends on the events being entered; an event that is missing from the plan is missing from the runway.

**The threshold.** Whether the default should remain 50% of today's balance, and how a user sets their own amount, is feedback item #7 and is decided separately (see [presentation feedback](presentation-feedback.md)). The measures above work with either: the engine already uses a workspace amount when one is stored.

## How the impact of a scenario is measured

A scenario changes events in memory only (a delayed invoice) and never the stored data. Its impact is the difference between the scenario forecast and the base forecast for the same account, horizon and exchange rate. The Scenario lab shows both side by side.

| Impact measure | Definition | Code field | What it tells the user |
| --- | --- | --- | --- |
| Change in the lowest balance | Scenario lowest balance minus base lowest balance | `minimumDelta` | How much of the cash buffer the scenario uses up. **This is our primary impact measure.** |
| First day below the threshold, base vs scenario | Both dates side by side, or "Not reached" | `firstDangerDate` of each forecast | Whether the scenario creates a need to act, and how soon |
| Runway, base vs scenario | Both runways side by side | `runwayDays` of each forecast | How much time the scenario takes away |
| Change in closing balance | Scenario closing balance minus base closing balance | `closingDelta` | Whether money is lost or moved out of the horizon |
| Contribution per adjustment | The change in closing balance when only that adjustment is applied; the contributions always add up to the total change (within 10⁻¹⁰ after currency conversion) | `contributions[].closingDelta` | Which delayed invoice moves money out of the horizon |

### Worked example (demo data)

Operating account, 90 days, seeded on 16 October 2026: the €9,000 customer invoice is delayed from 24 October to 14 November.

| Measure | Base | Scenario | Reading |
| --- | --- | --- | --- |
| Lowest balance | €13,500 on 25 Dec | €8,500 on 26 Oct | The delay uses €5,000 of buffer |
| First day below €10,000 | Not reached | 26 Oct | Payroll leaves before the invoice arrives |
| Runway | Not reached in 90 days | 10 days | Ten days to arrange a bridge or chase the customer |
| Closing balance | €13,500 | €13,500 | Unchanged: the invoice still arrives inside the horizon |
| Contribution of the invoice | | €0 | It moves no money out of the horizon |

The example also shows why the lowest balance, not the closing balance, is the primary impact measure: the closing balance says "no impact", the lowest balance and the runway say "act within ten days".

## Known gaps

- **Contributions explain the closing balance only.** A delay that stays inside the horizon contributes €0, even when it causes a breach, as in the example above. The timing effect is visible for the scenario as a whole (lowest balance, first day below the threshold, runway) but is not yet split per invoice. Splitting the change in the lowest balance per invoice is possible, but when two delays interact the split depends on the order in which they are applied, so it needs an agreed attribution rule first.
- **One account at a time.** There is no combined measure across accounts; combining accounts converted at different rates needs an agreed rule (see [limitations](limitations.md)).
- **FX shocks are previewed, not measured.** A shocked rate is shown next to the ECB rate, but its effect on the lowest balance and the runway is not computed yet.
- **Inputs, not predictions.** Every measure is only as complete as the events entered; nothing is estimated or extrapolated.

## How the measures are verified

- Engine rules (minimum and its first date, the threshold compared strictly below, runway, the default threshold): unit tests in `tests/unit/forecast`.
- Scenario impact (contributions add up to the total, the tolerance boundary, skipped adjustments): `tests/unit/forecast/scenario-comparison.test.ts`.
- The same measures against PostgreSQL with session-scoped data, including a dollar account compared in euro: `tests/integration/scenario-comparison.test.ts`.
