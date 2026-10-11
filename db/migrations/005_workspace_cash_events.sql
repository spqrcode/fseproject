-- Workspace, cash accounts and cash events. Ownership chain: user -> workspace -> account -> event.

-- The existing one-per-user "portfolio" is the workspace. RENAME keeps rows, constraints and the
-- staging role's grants; the old portfolios_* constraint names stay as they are.
ALTER TABLE portfolios RENAME TO workspaces;
-- NaN is a valid PostgreSQL numeric and passes comparisons such as "> 0", so every numeric column
-- excludes it explicitly. NULL means "no threshold set" and passes the CHECK.
ALTER TABLE workspaces ADD COLUMN danger_threshold numeric(20,2) CHECK (danger_threshold <> 'NaN');

CREATE TABLE cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80 AND name = btrim(name)),
  currency text NOT NULL CHECK (currency IN ('EUR', 'USD', 'SGD')),
  opening_balance numeric(20,2) NOT NULL CHECK (opening_balance <> 'NaN'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name),
  -- Not needed for uniqueness (id is already unique). It is the target of the composite foreign
  -- key below, which forces an event's account and workspace to belong together.
  UNIQUE (id, workspace_id)
);

CREATE TABLE cash_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200 AND description = btrim(description)),
  -- Signed: income > 0, expense < 0. The currency is the account's, so it is not stored twice.
  amount numeric(20,2) NOT NULL CHECK (amount <> 'NaN' AND amount <> 0),
  -- Date only. 'infinity' is a valid PostgreSQL date, so it is excluded like NaN.
  expected_date date NOT NULL CHECK (isfinite(expected_date)),
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'received', 'paid', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'received' OR amount > 0),
  CHECK (status <> 'paid' OR amount < 0),
  -- Lets later tables (scenario adjustments) use a composite foreign key (event_id, workspace_id)
  -- so a scenario can only reference events of its own workspace.
  UNIQUE (id, workspace_id),
  -- An event can only point at an account of the same workspace, so never at another user's account.
  -- Default NO ACTION: an account that still has events cannot be deleted by itself, while deleting
  -- the workspace removes events through their own cascade above.
  FOREIGN KEY (account_id, workspace_id) REFERENCES cash_accounts(id, workspace_id)
);

-- Event lists are read per workspace and date range. The unique constraints already index accounts.
CREATE INDEX cash_events_workspace_date_idx ON cash_events(workspace_id, expected_date);

-- Staging runtime role (see migration 003). Updates are limited to the columns the application edits,
-- so a faulty query cannot move an account or event to another workspace or change an account's
-- currency. The role does not exist locally or in CI, so the grants are optional.
-- workspaces needs nothing new: the renamed table keeps SELECT/INSERT/UPDATE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fse_runtime') THEN
    GRANT SELECT, INSERT ON cash_accounts TO fse_runtime;
    GRANT UPDATE (name, updated_at) ON cash_accounts TO fse_runtime;
    GRANT SELECT, INSERT, DELETE ON cash_events TO fse_runtime;
    GRANT UPDATE (description, amount, expected_date, status, updated_at) ON cash_events TO fse_runtime;
  END IF;
END
$$;
