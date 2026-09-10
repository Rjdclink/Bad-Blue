-- Ghost Wallet owns an isolated, durable event-driven runtime lane on Overflow.
-- Notifications are wake hints only; the durable rows are the recovery authority.
-- The Ultra Worker must never poll these tables on a timer.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_ghost_wallet_work (
  work_id text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN (
    'matched_intent_settlement',
    'prepared_atomic_execution',
    'profit_conversion',
    'source_refresh',
    'venue_probe',
    'settlement_reconcile'
  )),
  chain text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED','CLAIMED','PROCESSING','SUBMITTED','SETTLED','RETRYABLE','DEAD'
  )),
  priority integer NOT NULL DEFAULT 100,
  not_before timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 12 CHECK (max_attempts > 0),
  lease_owner text,
  lease_until timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  transaction_hash text,
  block_number bigint,
  profit_asset text,
  profit_amount_base_units numeric(78,0),
  realized_profit_usd numeric,
  payout_asset text NOT NULL DEFAULT 'ETH' CHECK (payout_asset = 'ETH'),
  payout_network text NOT NULL DEFAULT 'ethereum' CHECK (payout_network = 'ethereum'),
  payout_destination_mode text NOT NULL DEFAULT 'primary' CHECK (payout_destination_mode IN ('primary','fallback')),
  payout_transaction_hash text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  settled_at timestamptz,
  CHECK ((profit_amount_base_units IS NULL) OR profit_amount_base_units >= 0),
  CHECK ((realized_profit_usd IS NULL) OR realized_profit_usd >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ghost_wallet_work_ready
  ON private.cryptocrawler_ghost_wallet_work(priority DESC, not_before ASC, created_at ASC)
  WHERE status IN ('QUEUED','RETRYABLE');
CREATE INDEX IF NOT EXISTS idx_ghost_wallet_work_lease
  ON private.cryptocrawler_ghost_wallet_work(lease_until)
  WHERE status IN ('CLAIMED','PROCESSING','SUBMITTED');
CREATE INDEX IF NOT EXISTS idx_ghost_wallet_work_tx
  ON private.cryptocrawler_ghost_wallet_work(transaction_hash)
  WHERE transaction_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_ghost_wallet_venues (
  venue_id text PRIMARY KEY,
  chain text NOT NULL,
  protocol text NOT NULL,
  role text NOT NULL CHECK (role IN ('lender','borrower','both')),
  address text NOT NULL,
  asset text,
  adapter text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_from text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  last_verified_at timestamptz,
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chain, protocol, role, address, asset)
);

CREATE INDEX IF NOT EXISTS idx_ghost_wallet_venues_active
  ON private.cryptocrawler_ghost_wallet_venues(chain, role, verified, enabled, last_verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_ghost_wallet_venues_asset
  ON private.cryptocrawler_ghost_wallet_venues(chain, asset, verified, enabled);

CREATE TABLE IF NOT EXISTS private.cryptocrawler_ghost_wallet_runtime_state (
  chain text PRIMARY KEY,
  last_reconciled_block bigint,
  last_notification_at timestamptz,
  last_listener_connected_at timestamptz,
  last_worker_activity_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION private.cryptocrawler_ghost_wallet_notify_work()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = private, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('QUEUED','RETRYABLE') THEN
    PERFORM pg_notify('cryptocrawler_ghost_wallet_work', NEW.work_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_ghost_wallet_notify_work
  ON private.cryptocrawler_ghost_wallet_work;
CREATE TRIGGER trg_cryptocrawler_ghost_wallet_notify_work
AFTER INSERT OR UPDATE OF status, not_before
ON private.cryptocrawler_ghost_wallet_work
FOR EACH ROW
EXECUTE FUNCTION private.cryptocrawler_ghost_wallet_notify_work();

ALTER TABLE private.cryptocrawler_ghost_wallet_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.cryptocrawler_ghost_wallet_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.cryptocrawler_ghost_wallet_runtime_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.cryptocrawler_ghost_wallet_work FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.cryptocrawler_ghost_wallet_venues FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.cryptocrawler_ghost_wallet_runtime_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cryptocrawler_ghost_wallet_notify_work() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.cryptocrawler_ghost_wallet_work IS
  'Durable Ghost Wallet work ledger. NOTIFY is only a wake hint; rows survive process and listener failure.';
COMMENT ON TABLE private.cryptocrawler_ghost_wallet_venues IS
  'Unbounded verified Ghost Wallet lender/borrower venue registry. Presence is not execution authority; adapters must reverify live capability.';
COMMENT ON TABLE private.cryptocrawler_ghost_wallet_runtime_state IS
  'Restart/reconciliation cursors for the isolated Ghost Wallet Ultra Worker.';
