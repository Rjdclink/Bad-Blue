-- Durable, isolated Ghost retained-profit -> native-gas replenishment ledger.
-- This never creates execution authority and never spends operator principal.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_ghost_wallet_gas_reserve (
  reserve_id text PRIMARY KEY,
  source_work_id text NOT NULL,
  chain text NOT NULL,
  asset text NOT NULL,
  amount_base_units numeric(78,0) NOT NULL CHECK (amount_base_units > 0),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PREPARED','SUBMITTED','SETTLED','RETRYABLE','DEAD')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 24 CHECK (max_attempts > 0),
  not_before timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  trade_hash text,
  settlement_transaction_hash text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  settled_at timestamptz,
  UNIQUE(source_work_id, chain, asset)
);

CREATE INDEX IF NOT EXISTS idx_ghost_wallet_gas_reserve_ready
  ON private.cryptocrawler_ghost_wallet_gas_reserve(not_before ASC, created_at ASC)
  WHERE status IN ('QUEUED','PREPARED','SUBMITTED','RETRYABLE');
CREATE INDEX IF NOT EXISTS idx_ghost_wallet_gas_reserve_lease
  ON private.cryptocrawler_ghost_wallet_gas_reserve(lease_until)
  WHERE lease_until IS NOT NULL;

ALTER TABLE private.cryptocrawler_ghost_wallet_gas_reserve ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_ghost_wallet_gas_reserve FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.cryptocrawler_ghost_wallet_gas_reserve IS
  'Durable Ghost retained-profit gas reserve replenishment. Source is retained realized Ghost profit only; no operator principal authority.';