# Engineering decisions

All entries are proposed and await team review. Implementation PRs must record accepted decisions and evidence.

| Decision | Why | Alternative | Accepted cost |
| --- | --- | --- | --- |
| One Next.js application with TypeScript | One deployable application and shared types | Separate frontend/backend | Framework coupling; server/client boundaries still need review |
| Application-managed accounts and PostgreSQL | Meets the requirement to own backend behavior without a hosted auth service | Managed authentication provider | Team must implement and test password hashing, sessions, revocation, and abuse controls |
| Central server-only data access with explicit ownership predicates | A simple authorization boundary that students can explain and test | PostgreSQL row-level security as an additional layer | Every operation must use this boundary; omitted predicates are a security defect |
| One portfolio per user initially | Small, complete management workflow | Multiple portfolios | Reduced functionality; schema can later relax the uniqueness constraint |
| USD instruments and current positions | Defensible valuation without FX or transaction accounting | Multi-currency ledger | No realized P/L or historical performance |
| Decimal financial arithmetic | Predictable decimal precision | Binary floating point throughout | Additional library and explicit conversion rules |
| Allocation and concentration only | Useful analytics from current prices | Volatility, VaR, or performance charts | Limited risk coverage |
| Server-side quote adapter | Keeps secrets private and isolates provider behavior | Direct browser requests | Server quota management and latency |

## Open decisions

- Verify current framework/runtime compatibility and pin dependency versions with a lockfile.
- Compare quote providers using actual USD stock/ETF coverage, free/education quotas, freshness, symbol resolution, licensing, caching permissions, and assessment availability. Do not assume any provider offers real-time data for free.
- Define numeric precision, input bounds, quote expiry, request timeout, and refresh limits before their implementation.
- Choose maintained password-hashing and database libraries; define session lifetime, cookie settings, login throttling, and account recovery scope.
- Find a persistent PostgreSQL host for assessment. Use local PostgreSQL for development; Vercel hosts the application, not the PostgreSQL process.
- Confirm available GitHub protections and hosting/database account limits.

## Defense record for significant changes

In the relevant PR, record: problem solved; implementation; why chosen; alternatives; trade-offs; tests and results; migration/deployment steps. Explain architectural problems before changing the design, and update this document when the decision changes.
