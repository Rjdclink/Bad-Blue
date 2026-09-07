-- Durable Polymarket event-order intent and recovery state.
-- The deterministic client_order_id is the idempotency authority. A signed body
-- is persisted before submission so ambiguous network outcomes can be recovered
-- without constructing or submitting a second economic order.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_polymarket_event_order_intents (
  client_order_id text PRIMARY KEY,
  market_id text NOT NULL,
  condition_id text NOT NULL CHECK (condition_id ~ '^0x[0-9a-fA-F]{64}$'),
  token_id text NOT NULL CHECK (token_id ~ '^[0-9]+$'),
  outcome text NOT NULL CHECK (outcome IN ('yes','no')),
  side text NOT NULL CHECK (side IN ('buy','sell')),
  contracts integer NOT NULL CHECK (contracts > 0),
  limit_price numeric(18,12) NOT NULL CHECK (limit_price > 0 AND limit_price < 1),
  time_in_force text NOT NULL CHECK (time_in_force IN ('fill_or_kill','immediate_or_cancel','good_till_canceled')),
  post_only boolean NOT NULL DEFAULT false,
  order_timestamp text NOT NULL CHECK (order_timestamp ~ '^[0-9]+$'),
  order_id text UNIQUE CHECK (order_id IS NULL OR order_id ~ '^0x[0-9a-fA-F]{64}$'),
  signed_body jsonb,
  status text NOT NULL DEFAULT 'PREPARING' CHECK (status IN (
    'PREPARING','PREPARED','SUBMISSION_UNKNOWN','OPEN','PARTIALLY_FILLED',
    'FILLED','CANCELLED','REJECTED','RECOVERY_REQUIRED'
  )),
  filled_contracts numeric(36,12) NOT NULL DEFAULT 0 CHECK (filled_contracts >= 0),
  average_fill_price numeric(18,12) CHECK (average_fill_price IS NULL OR (average_fill_price >= 0 AND average_fill_price <= 1)),
  realized_fee_usd numeric(36,12) CHECK (realized_fee_usd IS NULL OR realized_fee_usd >= 0),
  last_api_status text,
  last_error text,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polymarket_event_order_intents_order_id
  ON private.cryptocrawler_polymarket_event_order_intents(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_polymarket_event_order_intents_recovery
  ON private.cryptocrawler_polymarket_event_order_intents(status, updated_at)
  WHERE status IN ('PREPARING','PREPARED','SUBMISSION_UNKNOWN','OPEN','PARTIALLY_FILLED','RECOVERY_REQUIRED');

ALTER TABLE private.cryptocrawler_polymarket_event_order_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_polymarket_event_order_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_polymarket_event_order_intents TO service_role;

COMMENT ON TABLE private.cryptocrawler_polymarket_event_order_intents IS
  'Durable Polymarket event-order intents. Signed order payload is stored before submission; ambiguous submission must recover this exact order hash rather than create duplicate exposure.';
