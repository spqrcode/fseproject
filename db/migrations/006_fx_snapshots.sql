-- ECB FX rate snapshots.  Each row is one rate fetched from one provider
-- for one currency pair on one effective date.
--
-- Design choices:
--  - base_currency is always 'EUR' for ECB rows (EUR is the base in SDMX EXR).
--  - quote_currency is 'USD' or 'SGD'.
--  - rate is stored as NUMERIC(30,15); application validation rejects values
--    that would be rounded or overflow this representation.
--  - effective_date is the ECB TIME_PERIOD (the date the rate is valid for,
--    which may be a preceding working day on weekends/holidays).
--  - fetched_at is the server timestamp when the HTTP response was received.
--  - only fully validated provider responses are persisted. Failures are
--    returned by the service and never fabricated into snapshot rows.
--  - UNIQUE(provider, base_currency, quote_currency, effective_date, rate)
--    makes a repeated observation idempotent while preserving an ECB
--    correction as a new immutable snapshot with its own id.
--
CREATE TABLE fx_snapshots (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text           NOT NULL CHECK (
    length(provider) BETWEEN 1 AND 64 AND provider = btrim(provider)
  ),
  base_currency     text           NOT NULL CHECK (base_currency = 'EUR'),
  quote_currency    text           NOT NULL CHECK (quote_currency IN ('USD', 'SGD')),
  rate              numeric(30,15) NOT NULL CHECK (rate <> 'NaN' AND rate > 0),
  effective_date    date           NOT NULL CHECK (isfinite(effective_date)),
  fetched_at        timestamptz    NOT NULL DEFAULT now() CHECK (isfinite(fetched_at)),
  CONSTRAINT fx_snapshots_unique_rate
    UNIQUE (provider, base_currency, quote_currency, effective_date, rate)
);

CREATE INDEX fx_snapshots_lookup_idx
  ON fx_snapshots (
    provider, base_currency, quote_currency, effective_date DESC, fetched_at DESC
  );

-- The application reads cached rows, inserts newly validated snapshots and may
-- refresh only the fetch time when ECB repeats the same observation. A
-- corrected rate is inserted separately so an existing snapshot id is stable.
-- Cleanup and schema changes remain owner-only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fse_runtime') THEN
    GRANT SELECT, INSERT ON fx_snapshots TO fse_runtime;
    GRANT UPDATE (fetched_at) ON fx_snapshots TO fse_runtime;
  END IF;
END
$$;
