-- Light, dark, or follow the device. Unlike the currency list, these three values are fixed by the
-- interface itself, so the database can enforce the complete list.
ALTER TABLE users ADD COLUMN appearance text NOT NULL DEFAULT 'system'
  CHECK (appearance IN ('system', 'light', 'dark'));

-- As in migration 003: the staging runtime role may update this column and nothing else on users.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fse_runtime') THEN
    GRANT UPDATE (appearance) ON users TO fse_runtime;
  END IF;
END
$$;
