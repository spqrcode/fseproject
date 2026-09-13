CREATE TABLE holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  -- Uppercase is enforced so the unique constraint below cannot be sidestepped
  -- by entering the same instrument in a different case.
  symbol text NOT NULL CHECK (symbol = upper(symbol) AND symbol ~ '^[A-Z][A-Z0-9]{0,9}(\.[A-Z]{1,4})?$'),
  -- PostgreSQL sorts NaN above every other numeric, so "> 0" alone would accept
  -- 'NaN'. It is excluded explicitly. numeric(20, 8) caps the magnitude at 12
  -- digits before the decimal point, which is the same bound the form applies.
  quantity numeric(20, 8) NOT NULL CHECK (quantity <> 'NaN' AND quantity > 0),
  average_buy_price numeric(20, 8) NOT NULL CHECK (average_buy_price <> 'NaN' AND average_buy_price > 0 AND average_buy_price <= 1000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, symbol)
);
CREATE INDEX holdings_portfolio_id_idx ON holdings(portfolio_id);

-- Staging runs the application under a restricted role that has no privileges on
-- new tables. The role does not exist locally or in CI, so the grant is optional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fse_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON holdings TO fse_runtime;
  END IF;
END
$$;
