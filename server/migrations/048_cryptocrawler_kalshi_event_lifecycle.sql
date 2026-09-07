-- Durable Kalshi event-contract lifecycle state.
-- The lifecycle lives on CryptoCrawler Overflow and never treats the authenticated
-- Kalshi account balance as system-owned capital. System-owned event cash is
-- reserved through migration 047 before any event order can be submitted.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_kalshi_event_lifecycles (
  lifecycle_id text PRIMARY KEY,
  opportunity_id text NOT NULL,
  ticker text NOT NULL,
  symbol text NOT NULL,
  status text NOT NULL,
  expected_net_profit_usd numeric NOT NULL,
  plan jsonb NOT NULL,
  cash_reservation_id uuid,
  entry_receipt jsonb,
  terminal_settlement jsonb,
  last_error text,
  feedback_applied_at timestamptz,
  feedback_lease_owner text,
  feedback_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cryptocrawler_kalshi_event_lifecycles_status_updated_idx
  ON private.cryptocrawler_kalshi_event_lifecycles (status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS cryptocrawler_kalshi_event_lifecycles_active_opportunity_idx
  ON private.cryptocrawler_kalshi_event_lifecycles (opportunity_id)
  WHERE status IN ('opening', 'waiting_settlement', 'settlement_unknown', 'quarantined');

CREATE INDEX IF NOT EXISTS cryptocrawler_kalshi_event_feedback_pending_idx
  ON private.cryptocrawler_kalshi_event_lifecycles (feedback_applied_at, updated_at)
  WHERE status='settled' AND feedback_applied_at IS NULL;

ALTER TABLE private.cryptocrawler_kalshi_event_lifecycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_kalshi_event_lifecycles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_kalshi_event_lifecycles TO service_role;

COMMENT ON TABLE private.cryptocrawler_kalshi_event_lifecycles IS
  'Durable Overflow-owned Kalshi event-contract lifecycle. Entry requires system-owned event cash and fresh authenticated depth; terminal settlement and feedback remain fail-closed until exchange evidence is complete.';