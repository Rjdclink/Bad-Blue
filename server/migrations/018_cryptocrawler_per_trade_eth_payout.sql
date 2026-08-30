CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE private.cryptocrawler_rainbow_profit_events
  ADD COLUMN IF NOT EXISTS payout_ratio numeric NOT NULL DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS retained_amount_usd numeric,
  ADD COLUMN IF NOT EXISTS payout_target_usd numeric,
  ADD COLUMN IF NOT EXISTS payout_asset text NOT NULL DEFAULT 'ETH',
  ADD COLUMN IF NOT EXISTS payout_network text NOT NULL DEFAULT 'Ethereum',
  ADD COLUMN IF NOT EXISTS conversion_quote_ccy text,
  ADD COLUMN IF NOT EXISTS conversion_quote_amount numeric,
  ADD COLUMN IF NOT EXISTS conversion_order_id text,
  ADD COLUMN IF NOT EXISTS conversion_eth_amount numeric,
  ADD COLUMN IF NOT EXISTS conversion_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS payout_triggered_at timestamptz;

ALTER TABLE private.cryptocrawler_rainbow_profit_events
  DROP CONSTRAINT IF EXISTS cryptocrawler_rainbow_profit_events_payout_ratio_check;
ALTER TABLE private.cryptocrawler_rainbow_profit_events
  ADD CONSTRAINT cryptocrawler_rainbow_profit_events_payout_ratio_check
  CHECK (payout_ratio > 0 AND payout_ratio < 1);

ALTER TABLE private.cryptocrawler_rainbow_profit_events
  DROP CONSTRAINT IF EXISTS cryptocrawler_rainbow_profit_events_retained_amount_usd_check;
ALTER TABLE private.cryptocrawler_rainbow_profit_events
  ADD CONSTRAINT cryptocrawler_rainbow_profit_events_retained_amount_usd_check
  CHECK (retained_amount_usd IS NULL OR retained_amount_usd >= 0);

ALTER TABLE private.cryptocrawler_rainbow_profit_events
  DROP CONSTRAINT IF EXISTS cryptocrawler_rainbow_profit_events_payout_target_usd_check;
ALTER TABLE private.cryptocrawler_rainbow_profit_events
  ADD CONSTRAINT cryptocrawler_rainbow_profit_events_payout_target_usd_check
  CHECK (payout_target_usd IS NULL OR payout_target_usd >= 0);

ALTER TABLE private.cryptocrawler_rainbow_profit_events
  DROP CONSTRAINT IF EXISTS cryptocrawler_rainbow_profit_events_conversion_status_check;
ALTER TABLE private.cryptocrawler_rainbow_profit_events
  ADD CONSTRAINT cryptocrawler_rainbow_profit_events_conversion_status_check
  CHECK (conversion_status IN ('PENDING','CONVERTING','CONVERTED','WITHDRAWING','CONFIRMED','RETRYABLE','MANUAL_REVIEW'));

UPDATE private.cryptocrawler_rainbow_profit_events
SET payout_ratio = 0.60,
    payout_target_usd = COALESCE(payout_target_usd, ROUND(realized_profit_usd * 0.60, 8)),
    retained_amount_usd = COALESCE(retained_amount_usd, realized_profit_usd - ROUND(realized_profit_usd * 0.60, 8)),
    payout_asset = 'ETH',
    payout_network = 'Ethereum'
WHERE payout_target_usd IS NULL OR retained_amount_usd IS NULL;

CREATE INDEX IF NOT EXISTS idx_rainbow_profit_payout_queue
  ON private.cryptocrawler_rainbow_profit_events(status, conversion_status, created_at);

COMMENT ON COLUMN private.cryptocrawler_rainbow_profit_events.payout_target_usd IS
  'Exactly 60% of terminal-confirmed realized profit assigned to the external MetaMask payout path before network fees.';
COMMENT ON COLUMN private.cryptocrawler_rainbow_profit_events.retained_amount_usd IS
  'Exactly 40% of terminal-confirmed realized profit retained as operating capital for strategies, gas, fees, and inventory.';
COMMENT ON COLUMN private.cryptocrawler_rainbow_profit_events.payout_asset IS
  'Canonical external payout asset. ETH only.';
COMMENT ON COLUMN private.cryptocrawler_rainbow_profit_events.payout_network IS
  'Canonical external payout network. Ethereum mainnet only.';