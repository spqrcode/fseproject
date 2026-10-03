-- ECB FX rate snapshots.  Each row is one rate fetched from one provider
-- for one currency pair on one effective date.
--
-- Design choices:
--  - base_currency is always 'EUR' for ECB rows (EUR is the base in SDMX EXR).
--  - quote_currency is 'USD' or 'SGD'.
--  - rate is stored as NUMERIC(30,15) — enough precision for any ECB rate.
--  - effective_date is the ECB TIME_PERIOD (the date the rate is valid for,
--    which may be a preceding working day on weekends/holidays).
--  - fetched_at is the server timestamp when the HTTP response was received.
--  - state: 'accepted' = validated and usable; 'rejected' = failed validation
--    (kept for audit trail).
--  - rejection_reason is non-null only when state = 'rejected'.
--  - UNIQUE(provider, base_currency, quote_currency, effective_date) prevents
--    duplicate snapshots; a second fetch for the same date is idempotent.
--
CREATE TABLE fx_snapshots (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text          NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
  base_currency     text          NOT NULL CHECK (base_currency  ~ '^[A-Z]{3}$'),
  quote_currency    text          NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate              numeric(30,15) NOT NULL CHECK (rate > 0),
  effective_date    date          NOT NULL,
  fetched_at        timestamptz   NOT NULL DEFAULT now(),
  state             text          NOT NULL DEFAULT 'accepted'
                                  CHECK (state IN ('accepted', 'rejected')),
  rejection_reason  text,
  CONSTRAINT fx_snapshots_unique_rate
    UNIQUE (provider, base_currency, quote_currency, effective_date),
  CONSTRAINT fx_snapshots_rejection_reason_check
    CHECK (
      (state = 'rejected' AND rejection_reason IS NOT NULL) OR
      (state = 'accepted' AND rejection_reason IS NULL)
    )
);

CREATE INDEX fx_snapshots_lookup_idx
  ON fx_snapshots (provider, base_currency, quote_currency, fetched_at DESC)
  WHERE state = 'accepted';
