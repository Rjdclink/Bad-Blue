CREATE TABLE IF NOT EXISTS zero_capital_native_gas_funding_attempts (
  idempotency_key varchar(255) PRIMARY KEY,
  scope varchar(255) NOT NULL,
  state varchar(32) NOT NULL CHECK (state IN ('PLANNED', 'SUBMITTED', 'SETTLED', 'FAILED')),
  strategy varchar(64),
  source_transaction_hash varchar(66) NOT NULL,
  destination_chain varchar(32) NOT NULL,
  destination_wallet varchar(42) NOT NULL,
  required_native_wei text NOT NULL,
  destination_transaction_hash varchar(66),
  delivered_native_wei text,
  destination_native_balance_before_wei text,
  destination_native_balance_after_wei text,
  source_proceeds_allocated_base_units text NOT NULL DEFAULT '0',
  reimbursement_required boolean NOT NULL DEFAULT false,
  reimbursement_verified boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS zero_capital_native_gas_funding_destination_tx_idx
  ON zero_capital_native_gas_funding_attempts (destination_transaction_hash)
  WHERE destination_transaction_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS zero_capital_native_gas_funding_scope_idx
  ON zero_capital_native_gas_funding_attempts (scope, updated_at DESC);