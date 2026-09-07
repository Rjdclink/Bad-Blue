-- Durable Kalshi event market-making state and realized maker performance.
-- All maker inventory must originate from system-owned event cash reservations;
-- authenticated Kalshi account positions never create ownership by themselves.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_kalshi_event_maker_lifecycles (
  lifecycle_id text PRIMARY KEY,
  opportunity_id text NOT NULL,
  ticker text NOT NULL,
  symbol text NOT NULL,
  status text NOT NULL,
  plan jsonb NOT NULL,
  cash_reservation_id uuid,
  order_group_id text,
  bid_revision integer NOT NULL DEFAULT 0,
  ask_revision integer NOT NULL DEFAULT 0,
  bid_order_id text,
  ask_order_id text,
  bid_filled_contracts numeric NOT NULL DEFAULT 0 CHECK (bid_filled_contracts >= 0),
  ask_filled_contracts numeric NOT NULL DEFAULT 0 CHECK (ask_filled_contracts >= 0),
  bid_fees_usd numeric NOT NULL DEFAULT 0 CHECK (bid_fees_usd >= 0),
  ask_fees_usd numeric NOT NULL DEFAULT 0 CHECK (ask_fees_usd >= 0),
  inventory_contracts numeric NOT NULL DEFAULT 0 CHECK (inventory_contracts >= 0),
  inventory_cost_usd numeric NOT NULL DEFAULT 0 CHECK (inventory_cost_usd >= 0),
  realized_proceeds_usd numeric NOT NULL DEFAULT 0 CHECK (realized_proceeds_usd >= 0),
  realized_fees_usd numeric NOT NULL DEFAULT 0 CHECK (realized_fees_usd >= 0),
  realized_net_profit_usd numeric,
  last_midpoint numeric,
  bid_queue_ahead numeric,
  ask_queue_ahead numeric,
  adverse_selection_bps numeric,
  last_quote_at timestamptz,
  terminal_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.cryptocrawler_kalshi_event_maker_lifecycles
  ADD COLUMN IF NOT EXISTS bid_filled_contracts numeric NOT NULL DEFAULT 0 CHECK (bid_filled_contracts >= 0),
  ADD COLUMN IF NOT EXISTS ask_filled_contracts numeric NOT NULL DEFAULT 0 CHECK (ask_filled_contracts >= 0),
  ADD COLUMN IF NOT EXISTS bid_fees_usd numeric NOT NULL DEFAULT 0 CHECK (bid_fees_usd >= 0),
  ADD COLUMN IF NOT EXISTS ask_fees_usd numeric NOT NULL DEFAULT 0 CHECK (ask_fees_usd >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS cryptocrawler_kalshi_event_maker_active_opportunity_idx
  ON private.cryptocrawler_kalshi_event_maker_lifecycles (opportunity_id)
  WHERE status IN ('quoting_bid','inventory_open','quoting_ask','settlement_wait','recovery_required');

CREATE INDEX IF NOT EXISTS cryptocrawler_kalshi_event_maker_status_updated_idx
  ON private.cryptocrawler_kalshi_event_maker_lifecycles (status, updated_at);

CREATE TABLE IF NOT EXISTS private.cryptocrawler_kalshi_event_maker_performance (
  ticker text PRIMARY KEY,
  terminal_samples integer NOT NULL DEFAULT 0 CHECK (terminal_samples >= 0),
  profitable_samples integer NOT NULL DEFAULT 0 CHECK (profitable_samples >= 0),
  maker_fill_samples integer NOT NULL DEFAULT 0 CHECK (maker_fill_samples >= 0),
  realized_net_bps_ewma numeric,
  adverse_selection_bps_ewma numeric,
  realized_fee_bps_ewma numeric,
  disabled boolean NOT NULL DEFAULT false,
  disabled_reason text,
  last_terminal_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.cryptocrawler_kalshi_event_maker_lifecycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.cryptocrawler_kalshi_event_maker_performance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_kalshi_event_maker_lifecycles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.cryptocrawler_kalshi_event_maker_performance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_kalshi_event_maker_lifecycles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_kalshi_event_maker_performance TO service_role;

COMMENT ON TABLE private.cryptocrawler_kalshi_event_maker_lifecycles IS
  'Durable Overflow-owned Kalshi event maker lifecycle. Inventory ownership is derived only from authenticated fills funded by system-owned event cash reservations.';
COMMENT ON TABLE private.cryptocrawler_kalshi_event_maker_performance IS
  'Terminal realized maker economics used to disable deteriorating maker behavior; counterfactual spread and unpaid incentives are never terminal evidence.';
