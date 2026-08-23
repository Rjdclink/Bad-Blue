CREATE TABLE IF NOT EXISTS zero_capital_execution_ledger (
  execution_key varchar(255) PRIMARY KEY,
  opportunity_id varchar(255) NOT NULL,
  chain varchar(32) NOT NULL,
  state varchar(32) NOT NULL CHECK (state IN ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'STALE')),
  state_fingerprint varchar(66) NOT NULL,
  receiver varchar(42) NOT NULL,
  transaction_hash varchar(66),
  transaction_nonce bigint,
  starting_native_balance_wei text,
  ending_native_balance_wei text,
  native_fee_wei text,
  starting_input_balance text,
  ending_input_balance text,
  realized_profit text,
  receipt_block bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS zero_capital_execution_ledger_transaction_hash_idx
  ON zero_capital_execution_ledger (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS zero_capital_execution_ledger_state_idx
  ON zero_capital_execution_ledger (state, updated_at DESC);