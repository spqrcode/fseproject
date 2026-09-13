# Limitations

## Current application

Issue 1 provides account/session handling and the existing portfolio setup UI. Holdings, stock quotes, valuations, P/L, and analytics are not implemented. Passing foundation tests does not mean the whole course specification is complete.

Email addresses are not verified. Password recovery, MFA, compromised-password screening, network-level abuse protection, and session housekeeping are absent. Per-address throttling can lock out a targeted address temporarily and does not stop attackers rotating addresses.

Authorization is enforced by the application, not database row-level policies. Production backup/restore exercises, audit logging, complete CSP, load testing, and independent security review remain future work. Hosted database/Vercel availability and quotas affect staging; no unconditional zero-cost or availability guarantee is made.

## Later financial scope

One portfolio per user, USD instruments, current positions and average purchase price. No transaction ledger, realized P/L, FX, dividends, fees, taxes, corporate-action accounting, trades, advice, or advanced risk models. Allocation and P/L contribution will be descriptive, not a complete measure of investment risk.

A real financial institution would need licensed data, reconciled accounting, reviewed financial methodology, stronger identity and access controls, monitoring, incident response, tested recovery, and legal/compliance assessment for its jurisdiction and use.
