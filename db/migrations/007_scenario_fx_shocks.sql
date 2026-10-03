-- Scenario FX shocks. Each row represents a percentage shock applied to an FX rate snapshot
-- within a scenario.
--
-- Financial rules:
--  - References a persisted snapshot (fx_snapshots.id) rather than copying or modifying it.
--  - References a parent scenario (scenarios.id).
--  - shock_percent must be strictly greater than -100 (a shock of -100% or lower would produce
--    a zero or negative exchange rate).
--  - ON DELETE RESTRICT on fx_snapshots prevents silent deletion of underlying historical rates.
--  - UNIQUE(scenario_id, snapshot_id) prevents conflicting duplicate shocks for the same snapshot.
--  - status tracks whether the shock is usable ('active') or invalidated ('invalid').
--
CREATE TABLE scenario_fx_shocks (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     uuid          NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  snapshot_id     uuid          NOT NULL REFERENCES fx_snapshots(id) ON DELETE RESTRICT,
  shock_percent   numeric(18,6) NOT NULL CHECK (shock_percent > -100),
  status          text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid')),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT scenario_fx_shocks_unique_scenario_snapshot
    UNIQUE (scenario_id, snapshot_id)
);

CREATE INDEX scenario_fx_shocks_scenario_id_idx ON scenario_fx_shocks(scenario_id);
CREATE INDEX scenario_fx_shocks_snapshot_id_idx ON scenario_fx_shocks(snapshot_id);
