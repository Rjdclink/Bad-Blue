CREATE SCHEMA IF NOT EXISTS private;

ALTER TABLE private.cryptocrawler_rainbow_profit_events
  ADD COLUMN IF NOT EXISTS payout_target_usd numeric,
  ADD COLUMN IF NOT EXISTS retained_target_usd numeric,
  ADD COLUMN IF NOT EXISTS payout_operating_cost_usd numeric NOT NULL DEFAULT 0;

ALTER TABLE private.cryptocrawler_rainbow_profit_events
  DROP CONSTRAINT IF EXISTS cryptocrawler_rainbow_profit_events_status_check;
ALTER TABLE private.cryptocrawler_rainbow_profit_events
  ADD CONSTRAINT cryptocrawler_rainbow_profit_events_status_check
  CHECK (status IN ('queued','converting','withdrawing','submitted','confirmed','retryable','manual_review','terminal_swept','failed'));

-- Restart drains can require more than one authenticated OKX withdrawal when the
-- remaining treasury exceeds the current per-withdrawal maximum. Preserve every
-- leg rather than overwriting a previously-confirmed transaction.
ALTER TABLE public.cryptocrawler_terminal_sweep_legs
  ADD COLUMN IF NOT EXISTS leg_sequence integer NOT NULL DEFAULT 1 CHECK (leg_sequence > 0);
ALTER TABLE public.cryptocrawler_terminal_sweep_legs
  DROP CONSTRAINT IF EXISTS cryptocrawler_terminal_sweep_legs_terminal_epoch_venue_asset_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_terminal_sweep_leg_sequence
  ON public.cryptocrawler_terminal_sweep_legs(terminal_epoch, venue, asset, leg_sequence);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_profit_payout_jobs (
  event_id text PRIMARY KEY,
  opportunity_id text,
  realized_profit_usd numeric NOT NULL CHECK (realized_profit_usd > 0),
  payout_target_usd numeric NOT NULL CHECK (payout_target_usd > 0),
  retained_target_usd numeric NOT NULL CHECK (retained_target_usd >= 0),
  payout_paid_usd numeric NOT NULL DEFAULT 0 CHECK (payout_paid_usd >= 0),
  payout_paid_eth numeric NOT NULL DEFAULT 0 CHECK (payout_paid_eth >= 0),
  payout_transactions jsonb NOT NULL DEFAULT '[]'::jsonb,
  payout_asset text NOT NULL DEFAULT 'ETH' CHECK (payout_asset = 'ETH'),
  payout_network text NOT NULL DEFAULT 'ethereum' CHECK (payout_network = 'ethereum'),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','CONVERTING','WITHDRAWING','SUBMITTED','CONFIRMED','RETRYABLE','MANUAL_REVIEW','TERMINAL_SWEPT')),
  source_venue text,
  quote_asset text,
  conversion_quote_id text,
  conversion_client_id text,
  conversion_trade_id text,
  conversion_quote_spent numeric,
  conversion_eth_acquired numeric,
  conversion_price_usd numeric,
  transfer_client_id text,
  transfer_id text,
  payout_amount_eth numeric,
  payout_fee_eth numeric,
  payout_operating_cost_usd numeric NOT NULL DEFAULT 0 CHECK (payout_operating_cost_usd >= 0),
  withdrawal_client_id text,
  withdrawal_id text,
  transaction_hash text,
  destination_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (abs((payout_target_usd + retained_target_usd) - realized_profit_usd) <= 0.000001),
  CHECK (payout_paid_usd <= payout_target_usd + 0.000001)
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_profit_payout_batches (
  batch_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED','CONVERTING','WITHDRAWING','SUBMITTED','CONFIRMED','RETRYABLE','MANUAL_REVIEW','TERMINAL_SWEPT')),
  target_usd numeric NOT NULL CHECK (target_usd > 0),
  payout_amount_eth numeric NOT NULL CHECK (payout_amount_eth > 0),
  reference_price_usd numeric NOT NULL CHECK (reference_price_usd > 0),
  quote_asset text,
  conversion_client_id text,
  conversion_trade_id text,
  conversion_quote_spent numeric,
  conversion_eth_acquired numeric,
  transfer_client_id text,
  transfer_id text,
  withdrawal_client_id text,
  withdrawal_id text,
  transaction_hash text,
  payout_fee_eth numeric NOT NULL DEFAULT 0 CHECK (payout_fee_eth >= 0),
  operating_cost_usd numeric NOT NULL DEFAULT 0 CHECK (operating_cost_usd >= 0),
  destination_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_profit_payout_batch_allocations (
  batch_id text NOT NULL REFERENCES public.cryptocrawler_profit_payout_batches(batch_id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.cryptocrawler_profit_payout_jobs(event_id) ON DELETE CASCADE,
  allocated_usd numeric NOT NULL CHECK (allocated_usd > 0),
  allocated_eth numeric NOT NULL CHECK (allocated_eth >= 0),
  PRIMARY KEY (batch_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_profit_payout_status
  ON public.cryptocrawler_profit_payout_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_profit_payout_withdrawal
  ON public.cryptocrawler_profit_payout_jobs(withdrawal_id)
  WHERE withdrawal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_profit_payout_conversion
  ON public.cryptocrawler_profit_payout_jobs(conversion_client_id)
  WHERE conversion_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_profit_payout_batch_status
  ON public.cryptocrawler_profit_payout_batches(status, created_at);
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_profit_payout_alloc_event
  ON public.cryptocrawler_profit_payout_batch_allocations(event_id);

ALTER TABLE public.cryptocrawler_profit_payout_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_profit_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_profit_payout_batch_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_profit_payout_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_profit_payout_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_profit_payout_batch_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_profit_payout_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_profit_payout_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_profit_payout_batch_allocations TO service_role;

CREATE OR REPLACE FUNCTION public.cryptocrawler_treasury_worker_claim(
  p_owner text,
  p_lease_seconds integer DEFAULT 90
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed integer := 0;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'worker owner is required';
  END IF;

  UPDATE public.cryptocrawler_terminal_sweep_control
  SET worker_lease_owner = p_owner,
      worker_lease_until = now() + make_interval(secs => greatest(30, least(300, p_lease_seconds))),
      updated_at = now()
  WHERE system_key = 'cryptocrawler'
    AND (
      worker_lease_owner = p_owner
      OR worker_lease_until IS NULL
      OR worker_lease_until < now()
    );
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_treasury_worker_release(p_owner text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed integer := 0;
BEGIN
  UPDATE public.cryptocrawler_terminal_sweep_control
  SET worker_lease_owner = NULL,
      worker_lease_until = NULL,
      updated_at = now()
  WHERE system_key = 'cryptocrawler'
    AND worker_lease_owner = p_owner;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_treasury_worker_claim(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_treasury_worker_release(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_treasury_worker_claim(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_treasury_worker_release(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cryptocrawler_profit_payout_job_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  event_status text;
  operating_cost_delta numeric := 0;
BEGIN
  event_status := CASE NEW.status
    WHEN 'QUEUED' THEN 'queued'
    WHEN 'CONVERTING' THEN 'converting'
    WHEN 'WITHDRAWING' THEN 'withdrawing'
    WHEN 'SUBMITTED' THEN 'submitted'
    WHEN 'CONFIRMED' THEN 'confirmed'
    WHEN 'RETRYABLE' THEN 'retryable'
    WHEN 'MANUAL_REVIEW' THEN 'manual_review'
    WHEN 'TERMINAL_SWEPT' THEN 'terminal_swept'
    ELSE 'failed'
  END;

  UPDATE private.cryptocrawler_rainbow_profit_events
  SET status = event_status,
      payout_target_usd = NEW.payout_target_usd,
      retained_target_usd = NEW.retained_target_usd,
      payout_operating_cost_usd = NEW.payout_operating_cost_usd,
      client_id = COALESCE(NEW.withdrawal_client_id, NEW.conversion_client_id, client_id),
      asset = 'ETH',
      chain = 'ethereum',
      payout_amount = NEW.payout_paid_eth,
      payout_fee = NEW.payout_fee_eth,
      withdrawal_id = NEW.withdrawal_id,
      transaction_hash = NEW.transaction_hash,
      last_error = NEW.last_error,
      confirmed_at = CASE
        WHEN NEW.status IN ('CONFIRMED','TERMINAL_SWEPT') THEN COALESCE(NEW.confirmed_at, confirmed_at, now())
        ELSE confirmed_at
      END,
      updated_at = now()
  WHERE event_id = NEW.event_id;

  IF TG_OP = 'UPDATE' THEN
    operating_cost_delta := greatest(0, NEW.payout_operating_cost_usd - OLD.payout_operating_cost_usd);
    IF operating_cost_delta > 0 THEN
      UPDATE public.cryptocrawler_terminal_sweep_control
      SET retained_profit_usd = greatest(0, retained_profit_usd - operating_cost_delta),
          updated_at = now()
      WHERE system_key = 'cryptocrawler';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_profit_payout_job_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_profit_payout_job_sync() TO service_role;

DROP TRIGGER IF EXISTS trg_cryptocrawler_profit_payout_job_sync
  ON public.cryptocrawler_profit_payout_jobs;
CREATE TRIGGER trg_cryptocrawler_profit_payout_job_sync
AFTER INSERT OR UPDATE ON public.cryptocrawler_profit_payout_jobs
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_profit_payout_job_sync();

CREATE OR REPLACE FUNCTION public.cryptocrawler_terminal_sweep_finalize_events(p_epoch uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  changed integer := 0;
  jobs_changed integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.cryptocrawler_terminal_sweep_control
    WHERE system_key='cryptocrawler'
      AND terminal_epoch=p_epoch
      AND desired_state='SWEPT'
  ) THEN
    RAISE EXCEPTION 'terminal epoch is not authoritatively swept';
  END IF;

  UPDATE public.cryptocrawler_profit_payout_batches
  SET status='TERMINAL_SWEPT', updated_at=now(), last_error=NULL
  WHERE status NOT IN ('CONFIRMED','TERMINAL_SWEPT');

  UPDATE public.cryptocrawler_profit_payout_jobs
  SET status='TERMINAL_SWEPT',
      confirmed_at=COALESCE(confirmed_at, now()),
      last_error=NULL,
      updated_at=now()
  WHERE status NOT IN ('CONFIRMED','TERMINAL_SWEPT');
  GET DIAGNOSTICS jobs_changed = ROW_COUNT;

  UPDATE private.cryptocrawler_rainbow_profit_events
  SET status='terminal_swept',
      batch_id=COALESCE(batch_id, 'terminal:' || p_epoch::text),
      confirmed_at=COALESCE(confirmed_at, now()),
      updated_at=now(),
      last_error=NULL
  WHERE status NOT IN ('confirmed','terminal_swept');
  GET DIAGNOSTICS changed = ROW_COUNT;

  UPDATE public.cryptocrawler_terminal_sweep_control
  SET retained_profit_usd=0,
      updated_at=now()
  WHERE system_key='cryptocrawler' AND terminal_epoch=p_epoch;

  RETURN greatest(changed, jobs_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_terminal_sweep_finalize_events(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_terminal_sweep_finalize_events(uuid) TO service_role;

COMMENT ON TABLE public.cryptocrawler_profit_payout_jobs IS
  'Durable per-terminal-profit accounting. Each profitable settlement allocates exactly 60% to ETH/Ethereum payout and 40% to spendable operating capital; multiple payout batches may satisfy one job when exchange limits require it.';
COMMENT ON TABLE public.cryptocrawler_profit_payout_batches IS
  'Idempotent OKX-to-Ethereum payout batches. Small per-trade obligations may aggregate to the live withdrawal minimum; large obligations may span batches up to the authenticated maximum.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_jobs.retained_target_usd IS
  'Accounting share retained for trading/gas/fees. This column is not an inventory reservation and must not make strategy capital unspendable.';
