-- Bound the stored shock (review of #17). The column was an unbounded numeric and the code only checked
-- "> -100", so +5000% or a 40-digit value was accepted. A stored shock is now a percentage from -99.99 to 100
-- with four decimals, the same rule as the application (parseShockPercent in src/lib/fx/fx-shock.ts).
--
-- numeric(7,4) holds up to 999.9999, so the range check does the bounding and the precision keeps the column
-- consistent with the other money-like columns. Existing rows from a database that already ran 008 keep their
-- values; the change fails loudly, not silently, if one of them is outside the new range or has more decimals.
ALTER TABLE scenario_fx_shocks
  ALTER COLUMN shock_percent TYPE numeric(7,4),
  ADD CONSTRAINT scenario_fx_shocks_percent_range CHECK (shock_percent BETWEEN -99.99 AND 100);
