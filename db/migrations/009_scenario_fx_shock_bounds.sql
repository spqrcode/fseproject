-- Bound the stored shock (review of #17). The column was an unbounded numeric and the code only checked
-- "> -100", so +5000% or a 40-digit value was accepted. A stored shock is now a percentage from -99.99 to 100
-- with four decimals, the same rule as the application (parseShockPercent in src/lib/fx/fx-shock.ts).
--
-- numeric(7,4) holds up to 999.9999, so the range check does the bounding and the precision keeps the column
-- consistent with the other money-like columns.
--
-- Existing rows must not change. Casting numeric to numeric(7,4) silently rounds extra decimals (1.23456 would
-- become 1.2346), which would alter a saved scenario without anyone editing it (review of #24). So the guard below
-- refuses to run while any saved shock is outside the new range or has more than four decimals; such rows have to
-- be corrected or invalidated deliberately first. With the guard passing, the cast changes no value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM scenario_fx_shocks
     WHERE shock_percent < -99.99 OR shock_percent > 100 OR shock_percent <> round(shock_percent, 4)
  ) THEN
    RAISE EXCEPTION 'Migration 009: some saved FX shocks are outside -99.99..100 or have more than four decimals. Correct or invalidate them first; converting the column would round them silently.';
  END IF;
END
$$;

ALTER TABLE scenario_fx_shocks
  ALTER COLUMN shock_percent TYPE numeric(7,4),
  ADD CONSTRAINT scenario_fx_shocks_percent_range CHECK (shock_percent BETWEEN -99.99 AND 100);
