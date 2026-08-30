CREATE TABLE IF NOT EXISTS public.cryptocrawler_payout_execution_reservations (
  batch_id text NOT NULL REFERENCES public.cryptocrawler_profit_payout_batches(batch_id) ON DELETE CASCADE,
  venue text NOT NULL DEFAULT 'okx' CHECK (venue='okx'),
  asset text NOT NULL,
  reserved_asset_amount numeric NOT NULL CHECK (reserved_asset_amount > 0),
  status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','IN_FLIGHT','RELEASED','TERMINAL_SWEPT','MANUAL_REVIEW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, venue, asset)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_payout_execution_reserve
  ON public.cryptocrawler_payout_execution_reservations(venue, asset, status)
  WHERE reserved_asset_amount > 0;

ALTER TABLE public.cryptocrawler_payout_execution_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_payout_execution_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_payout_execution_reservations TO service_role;

-- Claim OKX treasury liquidity under the same inventory-state row lock used by
-- live trade reservations. This prevents a new trade from winning a race after
-- the treasury has decided to use a balance, while never cancelling an existing
-- reservation or submitted order.
CREATE OR REPLACE FUNCTION public.cryptocrawler_treasury_claim_okx_liquidity(
  p_batch_id text,
  p_asset text,
  p_amount numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_asset text := upper(trim(p_asset));
  row_state record;
  active_trade_reserved numeric := 0;
  other_treasury_reserved numeric := 0;
  spendable numeric := 0;
BEGIN
  IF p_batch_id IS NULL OR length(trim(p_batch_id))=0 OR normalized_asset IS NULL OR length(normalized_asset)=0 OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN false;
  END IF;
  IF to_regclass('public.cryptocrawler_cex_inventory_state_v1') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE
    'SELECT available, pending_order, pending_transfer, minimum_reserve
       FROM public.cryptocrawler_cex_inventory_state_v1
      WHERE venue=$1 AND asset=$2
      FOR UPDATE'
    INTO row_state
    USING 'okx', normalized_asset;
  IF row_state IS NULL THEN
    RETURN false;
  END IF;

  IF to_regclass('public.cryptocrawler_cex_inventory_reservations_v1') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(SUM(amount),0)
         FROM public.cryptocrawler_cex_inventory_reservations_v1
        WHERE venue=$1 AND asset=$2 AND expires_at > now()'
      INTO active_trade_reserved
      USING 'okx', normalized_asset;
  END IF;

  SELECT COALESCE(SUM(reserved_asset_amount),0)
  INTO other_treasury_reserved
  FROM public.cryptocrawler_payout_execution_reservations
  WHERE venue='okx'
    AND asset=normalized_asset
    AND batch_id<>p_batch_id
    AND status IN ('HELD','IN_FLIGHT','MANUAL_REVIEW');

  spendable := greatest(
    0,
    COALESCE(row_state.available,0)
      - COALESCE(active_trade_reserved,0)
      - COALESCE(other_treasury_reserved,0)
      - COALESCE(row_state.pending_order,0)
      - COALESCE(row_state.pending_transfer,0)
      - COALESCE(row_state.minimum_reserve,0)
  );

  IF spendable + 0.000000001 < p_amount THEN
    RETURN false;
  END IF;

  INSERT INTO public.cryptocrawler_payout_execution_reservations
    (batch_id, venue, asset, reserved_asset_amount, status, created_at, updated_at)
  VALUES (p_batch_id, 'okx', normalized_asset, p_amount, 'HELD', now(), now())
  ON CONFLICT (batch_id, venue, asset) DO UPDATE SET
    reserved_asset_amount=EXCLUDED.reserved_asset_amount,
    status='HELD',
    updated_at=now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_treasury_claim_okx_liquidity(text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_treasury_claim_okx_liquidity(text, text, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.cryptocrawler_payout_execution_reservation_status_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status='CONFIRMED' AND OLD.status<>'CONFIRMED' THEN
    UPDATE public.cryptocrawler_payout_execution_reservations
    SET status='RELEASED', updated_at=now()
    WHERE batch_id=NEW.batch_id;

  ELSIF NEW.status='TERMINAL_SWEPT' AND OLD.status<>'TERMINAL_SWEPT' THEN
    UPDATE public.cryptocrawler_payout_execution_reservations
    SET status='TERMINAL_SWEPT', updated_at=now()
    WHERE batch_id=NEW.batch_id;

    UPDATE public.cryptocrawler_payout_asset_reservations
    SET status='TERMINAL_SWEPT', remaining_asset_amount=0, updated_at=now()
    WHERE event_id IN (
      SELECT event_id FROM public.cryptocrawler_profit_payout_batch_allocations WHERE batch_id=NEW.batch_id
    );

  ELSIF NEW.status='MANUAL_REVIEW' AND OLD.status<>'MANUAL_REVIEW' THEN
    UPDATE public.cryptocrawler_payout_execution_reservations
    SET status='MANUAL_REVIEW', updated_at=now()
    WHERE batch_id=NEW.batch_id;

    UPDATE public.cryptocrawler_profit_payout_jobs
    SET status='MANUAL_REVIEW',
        last_error=COALESCE(NEW.last_error, last_error, 'Payout batch requires manual review'),
        updated_at=now()
    WHERE event_id IN (
      SELECT event_id FROM public.cryptocrawler_profit_payout_batch_allocations WHERE batch_id=NEW.batch_id
    ) AND status NOT IN ('CONFIRMED','TERMINAL_SWEPT');

    UPDATE public.cryptocrawler_payout_asset_reservations
    SET status='MANUAL_REVIEW', updated_at=now()
    WHERE event_id IN (
      SELECT event_id FROM public.cryptocrawler_profit_payout_batch_allocations WHERE batch_id=NEW.batch_id
    ) AND remaining_asset_amount > 0;

  ELSIF NEW.status IN ('CONVERTING','WITHDRAWING','SUBMITTED') THEN
    UPDATE public.cryptocrawler_payout_execution_reservations
    SET status='IN_FLIGHT', updated_at=now()
    WHERE batch_id=NEW.batch_id AND status='HELD';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_payout_execution_reservation_status
  ON public.cryptocrawler_profit_payout_batches;
CREATE TRIGGER trg_cryptocrawler_payout_execution_reservation_status
AFTER UPDATE OF status ON public.cryptocrawler_profit_payout_batches
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_payout_execution_reservation_status_sync();

REVOKE ALL ON FUNCTION public.cryptocrawler_payout_execution_reservation_status_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_payout_execution_reservation_status_sync() TO service_role;

COMMENT ON TABLE public.cryptocrawler_payout_execution_reservations IS
  'Short-lived OKX liquidity claims for due payout batches. Claims share the durable inventory row lock with new trade reservations, so payout execution never cancels active trades and new trades cannot consume already-claimed payout liquidity.';
