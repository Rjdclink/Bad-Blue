-- Durable Kalshi <-> Polymarket complementary-payout lifecycle.
-- Each lifecycle owns both venue reservations and exact order identities until
-- both legs and both terminal settlements are reconciled. Ambiguous submission
-- is quarantined/recovered; it never creates a second economic order.

CREATE TABLE IF NOT EXISTS private.cryptocrawler_cross_venue_prediction_lifecycles (
  lifecycle_id text PRIMARY KEY,
  opportunity_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN (
    'RESERVED','KALSHI_SUBMITTING','KALSHI_FILLED','POLYMARKET_SUBMITTING',
    'BOTH_FILLED','RECOVERY_REQUIRED','UNWINDING_KALSHI','UNWOUND',
    'SETTLEMENT_WAIT','SETTLEMENT_UNKNOWN','SETTLED','FAILED','QUARANTINED'
  )),
  plan jsonb NOT NULL,
  operator_reservation_id text,
  kalshi_cash_reservation_id uuid,
  polymarket_cash_reservation_id uuid,
  kalshi_order_id text,
  polymarket_client_order_id text,
  polymarket_order_id text,
  kalshi_fill_contracts numeric(36,12) NOT NULL DEFAULT 0,
  polymarket_fill_contracts numeric(36,12) NOT NULL DEFAULT 0,
  kalshi_entry_cost_usd numeric(78,36),
  polymarket_entry_cost_usd numeric(78,36),
  kalshi_realized_fee_usd numeric(78,36),
  polymarket_realized_fee_usd numeric(78,36),
  kalshi_unwind_order_id text,
  kalshi_unwind_proceeds_usd numeric(78,36),
  kalshi_unwind_fee_usd numeric(78,36),
  kalshi_settlement jsonb,
  polymarket_settlement jsonb,
  realized_net_profit_usd numeric(78,36),
  last_error text,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cross_venue_prediction_lifecycle_recovery
  ON private.cryptocrawler_cross_venue_prediction_lifecycles(status,updated_at)
  WHERE status IN (
    'RESERVED','KALSHI_SUBMITTING','KALSHI_FILLED','POLYMARKET_SUBMITTING',
    'BOTH_FILLED','RECOVERY_REQUIRED','UNWINDING_KALSHI','SETTLEMENT_WAIT','SETTLEMENT_UNKNOWN'
  );

ALTER TABLE private.cryptocrawler_cross_venue_prediction_lifecycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_cross_venue_prediction_lifecycles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_cross_venue_prediction_lifecycles TO service_role;

COMMENT ON TABLE private.cryptocrawler_cross_venue_prediction_lifecycles IS
  'Durable complementary-payout Kalshi/Polymarket lifecycle. Both system-owned cash reservations stay held until true terminal reconciliation or a proven no-exposure unwind.';
