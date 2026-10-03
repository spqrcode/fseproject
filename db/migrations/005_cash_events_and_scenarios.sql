-- Cash events owned by a user.  Signed amount: positive = income, negative = expense.
-- amount is stored as numeric(19,4) – sufficient for four decimal places of currency.
-- currency is enforced to the three supported ISO codes.
-- expected_date is a date-only column (no time component).
-- Zero-amount events are rejected by the CHECK constraint.
CREATE TABLE cash_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description   text        NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200
                                        AND description = btrim(description)),
  amount        numeric(19,4) NOT NULL CHECK (amount <> 0),
  currency      text        NOT NULL CHECK (currency IN ('EUR','USD','SGD')),
  expected_date date        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cash_events_user_id_idx  ON cash_events(user_id);
CREATE INDEX cash_events_date_idx     ON cash_events(user_id, expected_date);

-- A named scenario belongs to a user.  One user can have many scenarios.
CREATE TABLE scenarios (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200
                                      AND name = btrim(name)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scenarios_user_id_idx ON scenarios(user_id);

-- A scenario_adjustment says: "in this scenario, treat event X as if its date is Y".
-- It does NOT copy the event; it only stores the override.
-- cash_event_id references the original event row; if that row is deleted the adjustment
-- becomes invalid (the FK is deliberately NOT ON DELETE CASCADE so we can surface that state).
-- date_override must differ from the original date; this is enforced in application logic
-- rather than SQL because the original date lives in another table.
-- status tracks whether the override is still usable:
--   'active'      – adjustment applies normally
--   'invalid'     – target event was deleted or is inaccessible; stored for audit trail
CREATE TABLE scenario_adjustments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     uuid        NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  cash_event_id   uuid        NOT NULL REFERENCES cash_events(id) ON DELETE RESTRICT,
  date_override   date        NOT NULL,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, cash_event_id)
);

CREATE INDEX scenario_adjustments_scenario_id_idx   ON scenario_adjustments(scenario_id);
CREATE INDEX scenario_adjustments_cash_event_id_idx ON scenario_adjustments(cash_event_id);
