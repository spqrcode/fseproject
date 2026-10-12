# Product experience

Owner: Gabriel (Product Experience), with Cash events and Scenario lab integration by Jiaxin. The product layer owns presentation and user interaction. Forecast calculations belong to Haina's Forecast Engine, and scenario and FX calculations belong to Jiaxin's domain services.

## Information architecture

| Route | Purpose | State in this increment |
| --- | --- | --- |
| `/` | Public home page: what FinTwin Global is, which views are available or in development, how it is built | Implemented; signed-in users are redirected to `/dashboard` |
| `/login`, `/register` | Account access | Existing, rebranded |
| `/dashboard` | Liquidity overview: the forecast from the Forecast Engine, plus the status of the workspace, reporting currency, cash events and scenario lab | Module status is connected; numerical forecast is withheld until the shared forecast-input adapter is connected |
| `/cash-events` | Cash accounts and planned income and expenses by date | Connected to the session-scoped cash-event store; create, edit, settle, cancel and delete expected events |
| `/scenarios` | Scenario lab: delayed invoices and ECB percentage-FX shocks | Connected to persisted scenarios and adjustments, with an ECB rate preview; numerical forecast comparison still awaits the shared adapter |
| `/workspace` | Workspace name stored in `workspaces` | Existing form, renamed from `/portfolio` |
| `/settings` | Reporting currency, appearance and active sessions | Implemented |

Every private route checks the session on the server (`requireUser`) and reads data only through session-scoped queries. The navigation marks exactly one current section with `aria-current="page"`, including nested routes added later (for example `/scenarios/compare`).

Section names follow the MVP views agreed by the team on 2 October 2026: Liquidity overview, Cash events and Scenario lab, then Workspace (which replaces the Portfolio page of the earlier project) and Settings. The forecast has no page of its own, because the projected balance is the main content of the liquidity overview. Routes keep short, stable paths (`/dashboard` is where sign-in lands), so renaming a label never breaks a link.

The home page marks Cash events as available and keeps the complete forecast and Scenario lab comparison in development. The logo on the sign-in and registration pages links back to it.

Pages that are not connected yet never show placeholder numbers. A demo figure on a financial screen can be mistaken for a real one, so the overview states that it has no projected balance yet. The Scenario lab displays persisted invoice dates and real ECB snapshot rates, but does not invent a cash-flow comparison. The Cash events page shows only persisted account and event values.

## US-11: cash accounts and events

As a signed-in user, I can record where cash is held and add dated income and expenses, so that the forecast has explicit, reviewable inputs.

Acceptance criteria:
- Cash accounts can be created only inside the signed-in user's workspace and use EUR, USD or SGD.
- Opening balances and event amounts remain decimal strings; income is positive, expenses negative and zero is rejected.
- New events start as `expected`. Expected events can be edited, deleted, marked received or paid according to their sign, or cancelled.
- Received, paid and cancelled events remain visible as an audit trail and cannot be edited or deleted.
- Deleting takes a second step (a native disclosure with "Delete permanently"), and the confirmation points to cancelling as the way to keep a record. Each action's accessible name includes the event (for example "Delete: Office rent"), starting with the visible words. An action on an event that has already changed is answered with a message rather than ignored. Dates use the shared `formatDate`.
- A user never supplies a workspace or user ID. Every action resolves ownership from the session and verifies the request origin.
- Empty, validation, success and error states are announced accessibly, and the page remains usable on a phone-sized viewport.

Implementation: `src/app/(protected)/cash-events/page.tsx`, `src/app/actions/cash-events.ts`, the three `cash-*` components, and `tests/e2e/cash-events.spec.ts`.

## Visual design

The interface follows an editorial direction, closer to a printed financial report than to a generic dashboard: warm paper background, ink-coloured type, hairline rules instead of shadows and rounded cards, and a single cobalt accent reserved for the brand mark, the current section and keyboard focus. Green and amber are used only for status, so they keep their meaning.

| Role | Typeface | Why |
| --- | --- | --- |
| Headings | Instrument Serif | High-contrast serif that gives page titles an editorial voice |
| Interface and body text | Schibsted Grotesk | Grotesk designed for a news publisher, readable at small sizes |
| Labels, codes and amounts | IBM Plex Mono | Monospaced and tabular, so figures line up in columns |

The fonts are installed from npm (Fontsource packages, SIL Open Font License) and served by the application itself. Visitors' browsers make no request to a third-party font service, which avoids sharing their IP address with that service and keeps the pages working when it is unreachable. Each font file covers a character range, so browsers download only the latin subset the interface uses.

The dark palette keeps the same roles: near-black paper, warm off-white ink, a lighter cobalt accent, and sign-in and onboarding panels that stay dark in both themes. Every colour in `globals.css` is a token, so the two palettes cannot drift apart.

The logo is two overlapping circles: the finances as they are and their twin. Header, page content and footer share one content column (`--edge` in `globals.css`), so every left edge lines up with the logo. Placeholder figures on the forecast and scenario pages are outlines with a "today" marker and no values, for the reason given under Information architecture.

## Shared states

- Loading: `src/app/(protected)/loading.tsx` shows a skeleton inside the application shell and announces "Loading this page" to screen readers.
- Error: `src/app/(protected)/error.tsx` keeps navigation and sign-out available, says that data was not changed, and offers a retry and a way back to the overview.
- Empty and not connected: `EmptyState` and status badges ("Ready", "Not created", "Not connected yet").
- Forms: errors use `role="alert"`, confirmations use `role="status"`, and buttons show progress while a server action runs.

## Presentation rules for amounts

`src/lib/format.ts` is the single place where amounts, percentages and timestamps become text. The Forecast Engine and Scenarios & FX pages should use it instead of formatting numbers themselves.

- Amounts are passed as decimal strings, the form PostgreSQL `numeric` values arrive in, and are never converted to JavaScript numbers. `12345678901234567.89` is displayed exactly; as a number it would lose its last digits.
- Rounding happens only at display time, half to even (1.245 becomes 1.24, 1.255 becomes 1.26), using the currency's own minor units (two decimals for EUR, USD and SGD). This is the rule the forecast engine uses when it rounds, so the screen never disagrees with a rounded calculation by a cent. Unrounded engine results with 40 significant digits are accepted as they are.
- A missing amount or an undefined ratio (for example a zero denominator) is shown as "Unavailable", never as 0, NaN or Infinity.
- Input that is not a plain decimal (exponent notation, `NaN`, grouping separators, empty strings) throws instead of printing a guessed value, so a bug in a calculation is visible during development rather than shown to users.
- Values that round to zero never show a minus sign. Changes can be shown with an explicit sign (`+US$25.00`).
- Locale `en-GB` and time zone UTC are fixed so the server and the browser render the same text, and timestamps carry the "UTC" label.

## US-08: reporting currency

As a signed-in user, I can choose the currency in which FinTwin Global reports my figures, so that totals, forecasts and scenarios are shown in the currency I think in.

Acceptance criteria:
- A new account reports in EUR.
- The settings page offers the currencies listed in [requirements](requirements.md#us-08-reporting-currency-and-navigation-fintwin-global), EUR, USD and SGD, and shows an example amount in the selected currency before saving.
- A saved choice survives reload and new sessions and is shown on the liquidity overview and the scenario lab.
- Unsupported, malformed or missing codes are rejected server-side with a useful message and leave the stored value unchanged.
- Only the signed-in user's own preference can change; a submitted user id is ignored. Anonymous, unknown and expired sessions are sent to sign in, and a missing or foreign request origin is rejected.
- The database refuses values that are not three uppercase letters even if the application is bypassed.

Implementation: `db/migrations/003_reporting_currency.sql`, `src/lib/currency.ts`, `reportingCurrencySchema` in `src/lib/validation.ts`, `src/lib/preferences-store.ts`, `src/app/actions/preferences.ts`, `src/components/currency-form.tsx`, `src/app/(protected)/settings/page.tsx`.

The currency is stored as a column on `users` because it is one value per account. The staging runtime role receives `UPDATE` on that column only, so the application still cannot change email addresses or password hashes. The list of offered currencies lives in the application, because it depends on the FX data that Scenarios & FX will supply; the database checks only the ISO 4217 shape.

## US-10: appearance

As a signed-in user, I can choose a light or dark interface, or let it follow my device, and the choice follows my account to every browser.

Acceptance criteria:
- A new account follows the device. Signed-out pages always follow the device.
- A saved choice applies to every signed-in page, survives reload and overrides the device setting.
- Only `system`, `light` and `dark` are accepted, by the server action and by a database `CHECK`.
- The same ownership, origin and session rules as the reporting currency apply.

Implementation: `db/migrations/004_appearance.sql`, `src/lib/appearance.ts`, `appearanceSchema`, `getPreferences`/`saveAppearance` in `src/lib/preferences-store.ts`, `updateAppearance`, `src/components/appearance-form.tsx`, and the dark palette in `globals.css`.

The protected layout renders the choice as `data-theme` on the application shell, so it is part of the first HTML response: there is no inline script and no flash of the wrong theme. The stylesheet switches its colour tokens with `:root:has([data-theme="dark"])`, or with `prefers-color-scheme: dark` unless the page carries `data-theme="light"`. `getPreferences` is wrapped in React's `cache`, so the layout (appearance) and the page (currency) share one database query per request. Browsers without `:has()` support (before 2023) keep the light theme for an explicit dark choice.

## US-09: active sessions

As a signed-in user, I can see where my account is signed in and sign out of every other session, so that a shared or lost device does not keep access to my data.

Acceptance criteria:
- The settings page lists my unexpired sessions with their start and expiry time in UTC, and marks the one in this browser.
- One action signs out every other session of my account; this browser stays signed in, and the other browsers are sent to sign in on their next request.
- Other users' sessions and expired sessions are never listed or affected.
- The action requires a valid session and a matching request origin, like every other mutation.
- Session token digests never leave the server.

Implementation: `src/lib/account-sessions.ts`, `src/app/actions/account.ts`, `src/components/sign-out-others.tsx` and the second section of the settings page. The delete statement joins the caller's own unexpired session (`mine`) to the rows it removes (`other`), so an expired or unknown token matches nothing and deletes nothing. It uses only the `SELECT` and `DELETE` privileges the staging runtime role already has on `sessions`; no new grant is needed.

Sessions record no browser name or IP address, so the list shows times only. Storing a user agent would make the list easier to read but adds personal data to keep and protect; that is left as a team decision.

## Accessibility

`tests/e2e/accessibility.spec.ts` runs axe-core against every public and signed-in page, plus a form error and a confirmation, in both light and dark mode, and fails on any WCAG 2.0, 2.1 or 2.2 level A or AA violation it can detect. Lowering the muted text colour by a few shades makes it fail with colour-contrast errors, which shows the check is effective. Automated rules find only part of what WCAG asks for, so keyboard use, focus order and the skip link are tested separately in the browser specs.

A skip link is the first keyboard stop on every page. Headings follow one `h1` per page. Form controls have visible labels and descriptions linked with `aria-describedby`. Status colours are paired with text. On phone-sized screens the navigation scrolls horizontally inside the header, scrolls itself so the current section is fully visible, and the page itself never scrolls sideways. Animations run only when the user has not asked for reduced motion.

## How the Forecast Engine and Scenarios & FX plug in

1. Connect the shared forecast-input adapter to `src/app/(protected)/dashboard/page.tsx` and the numerical base-versus-scenario comparison in `scenarios/page.tsx`. Cash events, scenario adjustments and FX preview are connected already.
2. Read the user's currency with `getReportingCurrency(token)` and format every value with `formatMoney`, `formatPercent` and `formatTimestamp`.
3. Pass amounts as decimal strings from the calculation layer; pass `null` when a value is unavailable.
4. Update the module row on the liquidity overview from "Not connected yet" to the real status.

## Verification

See [testing](testing.md). Unit tests cover formatting and currency validation, integration tests run the preference against real PostgreSQL, and Playwright covers navigation, persistence, expired sessions, keyboard access and phone-sized screens. The browser suite was also run with the application connected as a role holding exactly the documented staging privileges.

## Limitations

- The ECB service can resolve rates and the Scenario lab previews shocked rates. Forecast values are not yet converted or displayed on the product pages; the shared forecast-input adapter is still required.
- EUR is the default because the team and the assessment are based in Europe. Changing the default needs a migration and a decision in `decisions.md`.
- The interface is English only and uses a fixed `en-GB` number format.
- The Liquidity overview still needs the shared forecast-input adapter before it can show projected balances and runway. The Scenario lab intentionally shows dates and rate provenance without claiming a numerical cash-flow result.

## Scenario lab integration

As a signed-in user, I can create a named scenario, move an expected positive invoice to a later date inside that scenario, and see the original and hypothetical dates side by side. The original event stays unchanged on Cash events. The page also previews an ECB percentage shock with source and adjusted rates as decimal strings, effective date, provider and current/stale/unavailable status. Unavailable data has no adjusted number. Direct EUR/USD and EUR/SGD shocks may be saved against one immutable snapshot; cross and reciprocal rates remain preview-only. Saved shocks display that snapshot's ECB date and rate; if a different latest snapshot for the same pair is already cached, a hint says so without changing the saved result or making an ECB request.

Implementation: `src/app/(protected)/scenarios/page.tsx`, `src/app/actions/scenarios.ts`, `src/components/scenario-forms.tsx`, and `tests/e2e/scenarios.spec.ts`. Numerical base-versus-scenario forecasts are separate product work, although the shared adapter has merged.
