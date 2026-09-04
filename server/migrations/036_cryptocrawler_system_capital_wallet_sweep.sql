-- Normal-runtime $4,000 exchange threshold sweep authority.
-- A sweep is based only on settlement-derived system-owned lots; authenticated
-- account-wide balances remain reconciliation ceilings and can never create
-- CryptoCrawler ownership.

ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD COLUMN IF NOT EXISTS reference_eth_usd numeric,
  ADD COLUMN IF NOT EXISTS target_wallet_eth numeric,
  ADD COLUMN IF NOT EXISTS source_system_owned_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS route_transfer_id uuid,
  ADD COLUMN IF NOT EXISTS wallet_transfer_id uuid,
  ADD COLUMN IF NOT EXISTS withdrawal_client_id text,
  ADD COLUMN IF NOT EXISTS withdrawal_id text,
  ADD COLUMN IF NOT EXISTS withdrawal_fee_eth numeric,
  ADD COLUMN IF NOT EXISTS destination_mode text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS recipient_confirmed_destination_hash text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_amount_eth numeric,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_transaction_hash text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_block_number text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_sweep_batches_status_check;
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD CONSTRAINT cryptocrawler_system_capital_sweep_batches_status_check CHECK (
    status IN ('PREPARED','CONVERTING','ROUTING','WITHDRAWING','SUBMITTED','CONFIRMED','RETRYABLE','MANUAL_REVIEW')
  );
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_sweep_batches_destination_mode_check;
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD CONSTRAINT cryptocrawler_system_capital_sweep_batches_destination_mode_check CHECK (
    destination_mode IN ('primary','fallback')
  );
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_sweep_batches_target_eth_check;
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD CONSTRAINT cryptocrawler_system_capital_sweep_batches_target_eth_check CHECK (
    target_wallet_eth IS NULL OR target_wallet_eth > 0
  );
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_sweep_batches_reference_eth_check;
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD CONSTRAINT cryptocrawler_system_capital_sweep_batches_reference_eth_check CHECK (
    reference_eth_usd IS NULL OR reference_eth_usd > 0
  );
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_sweep_batches_attempt_check;
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD CONSTRAINT cryptocrawler_system_capital_sweep_batches_attempt_check CHECK (attempt_count >= 0);

-- Only one threshold sweep may own money-moving authority at a time. This keeps a
-- Kraken-to-OKX in-transit lot from being independently swept by a second batch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_one_active_system_capital_sweep
  ON public.cryptocrawler_system_capital_sweep_batches ((1))
  WHERE status IN ('PREPARED','CONVERTING','ROUTING','WITHDRAWING','SUBMITTED','RETRYABLE');

CREATE TABLE IF NOT EXISTS public.cryptocrawler_system_capital_sweep_conversions (
  conversion_id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.cryptocrawler_system_capital_sweep_batches(batch_id) ON DELETE CASCADE,
  venue text NOT NULL CHECK (venue IN ('kraken','okx')),
  source_asset text NOT NULL,
  target_asset text NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  requested_base_quantity numeric(78,36) NOT NULL CHECK (requested_base_quantity > 0),
  reserved_source_decimal numeric(78,36) NOT NULL CHECK (reserved_source_decimal > 0),
  limit_price numeric(78,36) NOT NULL CHECK (limit_price > 0),
  client_order_id text NOT NULL,
  exchange_order_id text,
  inventory_reservation_id text,
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','SUBMITTED','SETTLING','CONFIRMED','RETRYABLE','MANUAL_REVIEW','RELEASED')),
  source_debit_decimal numeric(78,36),
  target_credit_decimal numeric(78,36),
  settlement_reference text,
  settlement_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_asset <> target_asset)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_system_capital_sweep_conversion_client
  ON public.cryptocrawler_system_capital_sweep_conversions(venue, client_order_id);
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_system_capital_sweep_conversion_batch
  ON public.cryptocrawler_system_capital_sweep_conversions(batch_id, status, created_at);

ALTER TABLE public.cryptocrawler_system_capital_sweep_conversions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_system_capital_sweep_conversions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_system_capital_sweep_conversions TO service_role;

COMMENT ON TABLE public.cryptocrawler_system_capital_sweep_batches IS
  'Normal-runtime threshold sweep: when one venue has >$4,000 of settlement-derived system-owned capital, exactly 80% of the measured trigger value becomes the persisted wallet target. Raw operator/account balances have no ownership authority.';
COMMENT ON TABLE public.cryptocrawler_system_capital_sweep_conversions IS
  'Crash-recoverable FOK conversions used only to transform provenance-backed sweep capital into ETH. Exact authenticated settlement is applied through the canonical system-owned lot ledger.';
COMMENT ON INDEX public.uq_cryptocrawler_one_active_system_capital_sweep IS
  'Serializes threshold sweeps across replicas and venues so in-transit system-owned capital cannot be double-swept.';
