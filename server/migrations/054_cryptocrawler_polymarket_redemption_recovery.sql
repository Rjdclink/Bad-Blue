-- Durable Polymarket terminal redemption/reconciliation intent.
-- A winning conditional-token position is never treated as realized collateral
-- until the exact on-chain redemption is receipt-confirmed and its pUSD balance
-- delta is proven. The pre-redemption collateral balance is persisted before any
-- native transaction can be submitted so restart recovery never guesses profit.

CREATE TABLE IF NOT EXISTS private.cryptocrawler_polymarket_redemption_intents (
  redemption_id text PRIMARY KEY,
  lifecycle_id text NOT NULL UNIQUE,
  opportunity_id text NOT NULL,
  market_id text NOT NULL,
  condition_id text NOT NULL CHECK (condition_id ~ '^0x[0-9a-fA-F]{64}$'),
  token_id text NOT NULL CHECK (token_id ~ '^[0-9]+$'),
  complement_token_id text NOT NULL CHECK (complement_token_id ~ '^[0-9]+$'),
  outcome text NOT NULL CHECK (outcome IN ('yes','no')),
  contracts integer NOT NULL CHECK (contracts > 0),
  neg_risk boolean NOT NULL,
  status text NOT NULL CHECK (status IN (
    'PREPARING','SUBMISSION_UNKNOWN','SUBMITTED','CONFIRMED',
    'NO_REDEMPTION_REQUIRED','QUARANTINED'
  )),
  pre_collateral_base_units numeric(78,0) NOT NULL CHECK (pre_collateral_base_units >= 0),
  expected_payout_base_units numeric(78,0) NOT NULL CHECK (expected_payout_base_units >= 0),
  purchased_position_base_units numeric(78,0) NOT NULL CHECK (purchased_position_base_units >= 0),
  complement_position_base_units numeric(78,0) NOT NULL CHECK (complement_position_base_units >= 0),
  transaction_hash text UNIQUE CHECK (transaction_hash IS NULL OR transaction_hash ~* '^0x[0-9a-f]{64}$'),
  post_collateral_base_units numeric(78,0) CHECK (post_collateral_base_units IS NULL OR post_collateral_base_units >= 0),
  realized_payout_base_units numeric(78,0) CHECK (realized_payout_base_units IS NULL OR realized_payout_base_units >= 0),
  gas_spend_wei numeric(78,0) CHECK (gas_spend_wei IS NULL OR gas_spend_wei >= 0),
  receipt_evidence jsonb,
  last_error text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polymarket_redemption_recovery
  ON private.cryptocrawler_polymarket_redemption_intents(status, updated_at)
  WHERE status IN ('PREPARING','SUBMISSION_UNKNOWN','SUBMITTED');

ALTER TABLE private.cryptocrawler_polymarket_redemption_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_polymarket_redemption_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_polymarket_redemption_intents TO service_role;

COMMENT ON TABLE private.cryptocrawler_polymarket_redemption_intents IS
  'Exactly-once Polymarket redemption recovery. Requires isolated lifecycle position evidence, persisted pre-collateral balance, provenance-backed system-native gas, receipt confirmation and exact pUSD balance-delta proof before realized payout may enter canonical accounting.';
