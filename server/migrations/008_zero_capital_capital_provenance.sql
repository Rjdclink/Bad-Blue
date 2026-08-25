CREATE TABLE IF NOT EXISTS zero_capital_capital_state (
  scope varchar(255) PRIMARY KEY,
  lifecycle varchar(64) NOT NULL CHECK (lifecycle IN ('ZERO', 'ZERO_GAS_EXECUTION_READY', 'ATOMIC_EXECUTION_PENDING', 'FIRST_PROFIT_VERIFIED', 'SELF_FUNDED', 'ZERO_RECOVERY_REQUIRED')),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  asset varchar(128),
  internally_generated_balance text NOT NULL DEFAULT '0',
  chain varchar(32),
  origin_transaction_hash varchar(66),
  latest_execution_key varchar(255),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zero_capital_capital_events (
  event_id uuid PRIMARY KEY,
  scope varchar(255) NOT NULL REFERENCES zero_capital_capital_state(scope) ON DELETE CASCADE,
  lifecycle varchar(64) NOT NULL,
  generation integer NOT NULL,
  asset varchar(128),
  amount text,
  chain varchar(32),
  transaction_hash varchar(66),
  execution_key varchar(255),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zero_capital_capital_events_scope_idx
  ON zero_capital_capital_events (scope, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS zero_capital_capital_events_execution_key_idx
  ON zero_capital_capital_events (scope, execution_key)
  WHERE execution_key IS NOT NULL;