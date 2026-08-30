ALTER TABLE public.cryptocrawler_terminal_sweep_control
  ADD COLUMN IF NOT EXISTS profitable_payout_sequence bigint NOT NULL DEFAULT 0 CHECK (profitable_payout_sequence >= 0),
  ADD COLUMN IF NOT EXISTS last_profit_payout_scheduled_at timestamptz;

ALTER TABLE public.cryptocrawler_profit_payout_jobs
  ADD COLUMN IF NOT EXISTS payout_sequence bigint,
  ADD COLUMN IF NOT EXISTS payout_fraction numeric,
  ADD COLUMN IF NOT EXISTS retained_fraction numeric,
  ADD COLUMN IF NOT EXISTS scheduled_not_before timestamptz,
  ADD COLUMN IF NOT EXISTS source_asset text;

ALTER TABLE public.cryptocrawler_profit_payout_jobs
  DROP CONSTRAINT IF EXISTS cryptocrawler_profit_payout_jobs_fraction_check;
ALTER TABLE public.cryptocrawler_profit_payout_jobs
  ADD CONSTRAINT cryptocrawler_profit_payout_jobs_fraction_check CHECK (
    payout_fraction IS NULL OR (
      payout_fraction >= 0.55 AND payout_fraction <= 0.65 AND
      retained_fraction IS NOT NULL AND
      abs((payout_fraction + retained_fraction) - 1.0) <= 0.000000001
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_profit_payout_sequence
  ON public.cryptocrawler_profit_payout_jobs(payout_sequence)
  WHERE payout_sequence IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_profit_payout_due
  ON public.cryptocrawler_profit_payout_jobs(status, scheduled_not_before, created_at);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_payout_asset_reservations (
  event_id text PRIMARY KEY REFERENCES public.cryptocrawler_profit_payout_jobs(event_id) ON DELETE CASCADE,
  venue text NOT NULL CHECK (venue IN ('coinbase','kraken','okx')),
  asset text NOT NULL,
  reserved_asset_amount numeric NOT NULL CHECK (reserved_asset_amount > 0),
  remaining_asset_amount numeric NOT NULL CHECK (remaining_asset_amount >= 0),
  status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','IN_FLIGHT','RELEASED','TERMINAL_SWEPT','MANUAL_REVIEW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_asset_amount <= reserved_asset_amount + 0.000000001)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_payout_asset_reserve_spendability
  ON public.cryptocrawler_payout_asset_reservations(venue, asset, status)
  WHERE remaining_asset_amount > 0;

ALTER TABLE public.cryptocrawler_payout_asset_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_payout_asset_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_payout_asset_reservations TO service_role;

-- Treasury may use authenticated OKX liquidity only after subtracting live-trade
-- reservations, pending order/transfer amounts, and configured minimum reserves.
-- payout_reserved is intentionally NOT subtracted here: it protects payout capital
-- from NEW trades, while the treasury worker itself must remain able to spend it.
CREATE OR REPLACE FUNCTION public.cryptocrawler_okx_treasury_spendable(p_asset text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  row_state record;
  active_trade_reserved numeric := 0;
  normalized_asset text := upper(trim(p_asset));
BEGIN
  IF normalized_asset IS NULL OR length(normalized_asset) = 0 THEN
    RETURN NULL;
  END IF;
  IF to_regclass('public.cryptocrawler_cex_inventory_state_v1') IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE
    'SELECT available, pending_order, pending_transfer, minimum_reserve
       FROM public.cryptocrawler_cex_inventory_state_v1
      WHERE venue=$1 AND asset=$2'
    INTO row_state
    USING 'okx', normalized_asset;

  IF row_state IS NULL THEN
    RETURN NULL;
  END IF;

  IF to_regclass('public.cryptocrawler_cex_inventory_reservations_v1') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(SUM(amount),0)
         FROM public.cryptocrawler_cex_inventory_reservations_v1
        WHERE venue=$1 AND asset=$2 AND expires_at > now()'
      INTO active_trade_reserved
      USING 'okx', normalized_asset;
  END IF;

  RETURN greatest(
    0,
    COALESCE(row_state.available,0)
      - COALESCE(active_trade_reserved,0)
      - COALESCE(row_state.pending_order,0)
      - COALESCE(row_state.pending_transfer,0)
      - COALESCE(row_state.minimum_reserve,0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_okx_treasury_spendable(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_okx_treasury_spendable(text) TO service_role;

-- One on-chain batch can satisfy many small payout obligations, and one large
-- obligation can span several batches. Confirmation is applied atomically so a
-- restart can never double-credit a batch or release payout inventory without a
-- confirmed OKX Ethereum transaction hash.
CREATE OR REPLACE FUNCTION public.cryptocrawler_profit_payout_batch_confirm(
  p_batch_id text,
  p_withdrawal_id text,
  p_transaction_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  batch_row public.cryptocrawler_profit_payout_batches%ROWTYPE;
  allocation_row record;
  job_row public.cryptocrawler_profit_payout_jobs%ROWTYPE;
  next_paid_usd numeric;
  next_paid_eth numeric;
  cost_share numeric;
  fee_share numeric;
  changed integer := 0;
BEGIN
  IF p_transaction_hash IS NULL OR length(trim(p_transaction_hash)) = 0 THEN
    RAISE EXCEPTION 'confirmed payout batch requires an on-chain transaction hash';
  END IF;

  SELECT * INTO batch_row
  FROM public.cryptocrawler_profit_payout_batches
  WHERE batch_id=p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout batch not found: %', p_batch_id;
  END IF;
  IF batch_row.status='CONFIRMED' THEN
    RETURN 0;
  END IF;
  IF batch_row.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'payout batch % is not submitted', p_batch_id;
  END IF;

  UPDATE public.cryptocrawler_profit_payout_batches
  SET status='CONFIRMED',
      withdrawal_id=COALESCE(NULLIF(p_withdrawal_id,''), withdrawal_id),
      transaction_hash=p_transaction_hash,
      confirmed_at=COALESCE(confirmed_at, now()),
      last_error=NULL,
      updated_at=now()
  WHERE batch_id=p_batch_id;

  FOR allocation_row IN
    SELECT *
    FROM public.cryptocrawler_profit_payout_batch_allocations
    WHERE batch_id=p_batch_id
    ORDER BY event_id
  LOOP
    SELECT * INTO job_row
    FROM public.cryptocrawler_profit_payout_jobs
    WHERE event_id=allocation_row.event_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout job missing for batch allocation: %', allocation_row.event_id;
    END IF;

    next_paid_usd := least(job_row.payout_target_usd, job_row.payout_paid_usd + allocation_row.allocated_usd);
    next_paid_eth := job_row.payout_paid_eth + allocation_row.allocated_eth;
    cost_share := CASE
      WHEN batch_row.target_usd > 0 THEN batch_row.operating_cost_usd * allocation_row.allocated_usd / batch_row.target_usd
      ELSE 0
    END;
    fee_share := CASE
      WHEN batch_row.target_usd > 0 THEN batch_row.payout_fee_eth * allocation_row.allocated_usd / batch_row.target_usd
      ELSE 0
    END;

    UPDATE public.cryptocrawler_profit_payout_jobs
    SET payout_paid_usd=next_paid_usd,
        payout_paid_eth=next_paid_eth,
        payout_transactions=COALESCE(payout_transactions, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'batchId', p_batch_id,
          'allocatedUsd', allocation_row.allocated_usd,
          'allocatedEth', allocation_row.allocated_eth,
          'withdrawalId', COALESCE(NULLIF(p_withdrawal_id,''), batch_row.withdrawal_id),
          'transactionHash', p_transaction_hash,
          'confirmedAt', now()
        )),
        payout_fee_eth=COALESCE(payout_fee_eth,0) + fee_share,
        payout_operating_cost_usd=COALESCE(payout_operating_cost_usd,0) + cost_share,
        withdrawal_id=COALESCE(NULLIF(p_withdrawal_id,''), batch_row.withdrawal_id, withdrawal_id),
        transaction_hash=p_transaction_hash,
        status=CASE
          WHEN next_paid_usd + 0.000001 >= payout_target_usd THEN 'CONFIRMED'
          ELSE 'QUEUED'
        END,
        confirmed_at=CASE
          WHEN next_paid_usd + 0.000001 >= payout_target_usd THEN COALESCE(confirmed_at, now())
          ELSE confirmed_at
        END,
        last_error=NULL,
        updated_at=now()
    WHERE event_id=allocation_row.event_id;

    UPDATE public.cryptocrawler_payout_asset_reservations
    SET remaining_asset_amount=greatest(0, remaining_asset_amount - allocation_row.allocated_usd),
        status=CASE
          WHEN greatest(0, remaining_asset_amount - allocation_row.allocated_usd) <= 0.000001 THEN 'RELEASED'
          ELSE 'HELD'
        END,
        updated_at=now()
    WHERE event_id=allocation_row.event_id;

    changed := changed + 1;
  END LOOP;

  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_profit_payout_batch_confirm(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_profit_payout_batch_confirm(text, text, text) TO service_role;

COMMENT ON COLUMN public.cryptocrawler_profit_payout_jobs.payout_fraction IS
  'Persisted capital-allocation decision. First three profitable settlements use 0.60; later settlements use one bounded 0.55-0.65 strategy draw chosen once and never re-rolled.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_jobs.scheduled_not_before IS
  'Earliest treasury execution time. Scheduling is persisted so retries/restarts never change the original strategy decision.';
COMMENT ON TABLE public.cryptocrawler_payout_asset_reservations IS
  'Payout capital excluded from NEW trade spendability after terminal settlement. It never cancels or preempts an already-reserved live trade; retained capital remains unreserved.';
