CREATE TABLE IF NOT EXISTS railway_bootstrap_budget_events (
  event_id varchar(255) PRIMARY KEY,
  spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0),
  reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
  hard_limit_reached boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS railway_bootstrap_budget_reservations (
  event_id varchar(255) NOT NULL REFERENCES railway_bootstrap_budget_events(event_id) ON DELETE CASCADE,
  work_id varchar(255) NOT NULL,
  projected_micro_usd bigint NOT NULL CHECK (projected_micro_usd >= 0),
  actual_micro_usd bigint,
  state varchar(16) NOT NULL CHECK (state IN ('RESERVED', 'SETTLED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, work_id)
);

CREATE INDEX IF NOT EXISTS railway_bootstrap_budget_reservations_state_idx
  ON railway_bootstrap_budget_reservations (event_id, state);