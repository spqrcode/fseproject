-- Currency in which the interface reports amounts. The database enforces the ISO 4217 shape;
-- the application decides which codes are offered, because that list depends on FX coverage.
ALTER TABLE users ADD COLUMN reporting_currency text NOT NULL DEFAULT 'EUR'
  CHECK (reporting_currency ~ '^[A-Z]{3}$');

-- Staging runs the application under a restricted role without UPDATE on users. Only this
-- column is granted, so the runtime role still cannot change email addresses or password hashes.
-- The role does not exist locally or in CI, so the grant is optional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fse_runtime') THEN
    GRANT UPDATE (reporting_currency) ON users TO fse_runtime;
  END IF;
END
$$;
