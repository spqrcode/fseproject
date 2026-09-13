# Limitations

## Current application

Issue 1 provides account and session handling and the portfolio setup UI; Issue 2 adds holdings. Stock quotes, valuations, P/L, and analytics are not implemented. Passing these tests does not mean the whole course specification is complete.

Holdings are recorded exactly as typed. The ticker pattern is a shape check, not a check that the instrument exists on any exchange, and nothing yet reconciles a symbol against a data provider, so a user can save a well-formed ticker that no market recognises. Average purchase price is a single number the user maintains by hand: there is no transaction history, so the application cannot recompute it after a further purchase, and it does not detect a value that is implausible for the instrument.

Email addresses are not verified. Password recovery, MFA, compromised-password screening, network-level abuse protection, and session housekeeping are absent. Per-address throttling can lock out a targeted address temporarily and does not stop attackers rotating addresses.

Authorization is enforced by the application, not database row-level policies. Production backup/restore exercises, audit logging, complete CSP, load testing, and independent security review remain future work. Hosted database/Vercel availability and quotas affect staging; no unconditional zero-cost or availability guarantee is made.

## Later financial scope

One portfolio per user, USD instruments, current positions and average purchase price. No transaction ledger, realized P/L, FX, dividends, fees, taxes, corporate-action accounting, trades, advice, or advanced risk models. Allocation and P/L contribution will be descriptive, not a complete measure of investment risk.

A real financial institution would need licensed data, reconciled accounting, reviewed financial methodology, stronger identity and access controls, monitoring, incident response, tested recovery, and legal/compliance assessment for its jurisdiction and use.
