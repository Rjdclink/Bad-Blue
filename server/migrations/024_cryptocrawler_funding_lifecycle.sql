-- Durable funding-arbitrage lifecycle state is migration-owned.
-- Runtime funding code must verify this table and fail closed; it must not run DDL.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_funding_lifecycles (
  lifecycle_id text PRIMARY KEY,
  opportunity_id text NOT NULL,
  venue text NOT NULL,
  symbol text NOT NULL,
  status text NOT NULL,
  expected_net_profit_usd numeric NOT NULL,
  plan jsonb NOT NULL,
  open_receipt jsonb,
  terminal_settlement jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cryptocrawler_funding_lifecycles_status_updated_idx
  ON private.cryptocrawler_funding_lifecycles (status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS cryptocrawler_funding_lifecycles_active_opportunity_idx
  ON private.cryptocrawler_funding_lifecycles (opportunity_id)
  WHERE status IN ('opening', 'open', 'closing', 'settlement_unknown');

ALTER TABLE private.cryptocrawler_funding_lifecycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_funding_lifecycles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_funding_lifecycles TO service_role;

COMMENT ON TABLE private.cryptocrawler_funding_lifecycles IS
  'Durable CryptoCrawler funding-arbitrage state machine. Schema is migration-owned; runtime advances lifecycle state without DDL or long-lived sessions.';
