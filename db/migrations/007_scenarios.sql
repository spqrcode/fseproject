-- Delayed-invoice scenarios. Migration 006 is reserved for ECB FX snapshots.
-- A scenario is an overlay: it references a real cash event but never rewrites that event.

CREATE TABLE scenarios (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200
                                        AND name = btrim(name)),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Target for the composite foreign key below. This lets PostgreSQL prove that an
  -- adjustment and its scenario belong to the same workspace.
  UNIQUE (id, workspace_id)
);

CREATE INDEX scenarios_workspace_id_idx ON scenarios(workspace_id);

-- A delay adjustment says: "in this scenario, treat event X as if its date were Y".
-- workspace_id is repeated deliberately so both composite foreign keys enforce isolation.
-- Deleting an expected event removes its hypothetical adjustment; settled events cannot be
-- deleted through the application store in migration 005.
CREATE TABLE scenario_adjustments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL,
  scenario_id     uuid        NOT NULL,
  cash_event_id   uuid        NOT NULL,
  date_override   date        NOT NULL CHECK (isfinite(date_override)),
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, cash_event_id),
  FOREIGN KEY (scenario_id, workspace_id)
    REFERENCES scenarios(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (cash_event_id, workspace_id)
    REFERENCES cash_events(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX scenario_adjustments_scenario_id_idx ON scenario_adjustments(scenario_id);
CREATE INDEX scenario_adjustments_cash_event_id_idx ON scenario_adjustments(cash_event_id);

-- Staging uses the restricted runtime role introduced by the Foundation work. The role is
-- absent in local development and CI, so grants are guarded like migrations 003–005.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fse_runtime') THEN
    GRANT SELECT, INSERT ON scenarios TO fse_runtime;
    GRANT SELECT, INSERT ON scenario_adjustments TO fse_runtime;
    GRANT UPDATE (status, updated_at) ON scenario_adjustments TO fse_runtime;
  END IF;
END
$$;
