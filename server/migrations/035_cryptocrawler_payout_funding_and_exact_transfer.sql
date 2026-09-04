-- Kraken-sourced terminal payout obligations must not be consumed by the OKX-only
-- payout worker until the reserved profit asset has physically arrived on OKX.
-- Coinbase remains on the existing pooled payout path to avoid changing its
-- evidence-only execution-capital posture in this migration.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_payout_funding_transfers (
  event_id text PRIMARY KEY REFERENCES public.cryptocrawler_profit_payout_jobs(event_id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL UNIQUE,
  source_venue text NOT NULL CHECK (source_venue='kraken'),
  target_venue text NOT NULL DEFAULT 'okx' CHECK (target_venue='okx'),
  asset text NOT NULL,
  requested_source_decimal numeric(78,36) NOT NULL CHECK (requested_source_decimal > 0),
  expected_destination_decimal numeric(78,36) NOT NULL CHECK (expected_destination_decimal > 0),
  delivered_destination_decimal numeric(78,36),
  source_fee_decimal numeric(78,36),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','SUBMITTED','SETTLING','CONFIRMED','RETRYABLE','MANUAL_REVIEW')),
  withdrawal_key text,
  withdrawal_reference text,
  transaction_hash text,
  destination_reference text,
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  destination_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_payout_funding_status
  ON public.cryptocrawler_payout_funding_transfers(status, created_at);

CREATE OR REPLACE FUNCTION public.cryptocrawler_gate_non_okx_payout_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(COALESCE(NEW.source_venue,''))='kraken'
     AND NEW.status IN ('QUEUED','RETRYABLE') THEN
    NEW.scheduled_not_before := 'infinity'::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_gate_non_okx_payout_schedule
  ON public.cryptocrawler_profit_payout_jobs;
CREATE TRIGGER trg_cryptocrawler_gate_non_okx_payout_schedule
BEFORE INSERT OR UPDATE OF source_venue, status, scheduled_not_before
ON public.cryptocrawler_profit_payout_jobs
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_gate_non_okx_payout_schedule();

CREATE OR REPLACE FUNCTION public.cryptocrawler_confirm_payout_funding_transfer(
  p_event_id text,
  p_delivered_decimal numeric,
  p_source_fee_decimal numeric,
  p_withdrawal_reference text,
  p_transaction_hash text,
  p_destination_reference text,
  p_source_evidence jsonb,
  p_destination_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  funding_row record;
  reservation_row record;
BEGIN
  SELECT * INTO funding_row
  FROM public.cryptocrawler_payout_funding_transfers
  WHERE event_id=p_event_id
  FOR UPDATE;
  IF funding_row IS NULL THEN RETURN false; END IF;
  IF funding_row.status='CONFIRMED' THEN RETURN true; END IF;
  IF funding_row.status NOT IN ('SUBMITTED','SETTLING') THEN RETURN false; END IF;
  IF p_delivered_decimal IS NULL OR p_delivered_decimal <= 0 OR p_source_fee_decimal IS NULL OR p_source_fee_decimal < 0 THEN RETURN false; END IF;

  SELECT * INTO reservation_row
  FROM public.cryptocrawler_payout_asset_reservations
  WHERE event_id=p_event_id
  FOR UPDATE;
  IF reservation_row IS NULL OR lower(reservation_row.venue)<>'kraken' THEN
    RAISE EXCEPTION 'Kraken payout funding confirmation requires the original terminal-profit asset reservation';
  END IF;
  IF p_delivered_decimal + 0.000000001 < reservation_row.remaining_asset_amount THEN
    RAISE EXCEPTION 'OKX delivered payout funding is below the durable reserved payout amount';
  END IF;

  UPDATE public.cryptocrawler_payout_funding_transfers
  SET delivered_destination_decimal=p_delivered_decimal,
      source_fee_decimal=p_source_fee_decimal,
      status='CONFIRMED',
      withdrawal_reference=COALESCE(NULLIF(trim(p_withdrawal_reference),''), withdrawal_reference),
      transaction_hash=COALESCE(NULLIF(trim(p_transaction_hash),''), transaction_hash),
      destination_reference=COALESCE(NULLIF(trim(p_destination_reference),''), destination_reference),
      source_evidence=COALESCE(source_evidence,'{}'::jsonb) || COALESCE(p_source_evidence,'{}'::jsonb),
      destination_evidence=COALESCE(destination_evidence,'{}'::jsonb) || COALESCE(p_destination_evidence,'{}'::jsonb),
      confirmed_at=COALESCE(confirmed_at,now()),
      updated_at=now(),
      last_error=NULL
  WHERE event_id=p_event_id;

  UPDATE public.cryptocrawler_payout_asset_reservations
  SET venue='okx', status='HELD', updated_at=now()
  WHERE event_id=p_event_id;

  UPDATE public.cryptocrawler_profit_payout_jobs
  SET source_venue='okx',
      source_asset=funding_row.asset,
      scheduled_not_before=now(),
      status=CASE WHEN status='RETRYABLE' THEN 'QUEUED' ELSE status END,
      last_error=NULL,
      updated_at=now()
  WHERE event_id=p_event_id
    AND status NOT IN ('CONFIRMED','TERMINAL_SWEPT','MANUAL_REVIEW');

  RETURN true;
END;
$$;

-- Exact system-capital confirmation consumes only the source units actually
-- debited by the authenticated exchange operation. Any unused portion of the
-- prior maximum reservation is released back to its original lot.
CREATE OR REPLACE FUNCTION public.cryptocrawler_confirm_system_capital_transfer_exact(
  p_transfer_id uuid,
  p_source_debit_decimal numeric,
  p_delivered_decimal numeric,
  p_source_fee_decimal numeric,
  p_settlement_reference text,
  p_transaction_hash text,
  p_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_row record;
  reserved_total numeric := 0;
  debit_remaining numeric := p_source_debit_decimal;
  row_lot record;
  consume_amount numeric;
  new_remaining numeric;
BEGIN
  SELECT * INTO transfer_row
  FROM public.cryptocrawler_system_capital_transfers
  WHERE transfer_id=p_transfer_id
  FOR UPDATE;
  IF transfer_row IS NULL THEN RETURN false; END IF;
  IF transfer_row.status='CONFIRMED' THEN RETURN true; END IF;
  IF transfer_row.status NOT IN ('SUBMITTED','SETTLING') THEN RETURN false; END IF;
  IF p_source_debit_decimal IS NULL OR p_source_debit_decimal <= 0
     OR p_delivered_decimal IS NULL OR p_delivered_decimal <= 0
     OR p_source_fee_decimal IS NULL OR p_source_fee_decimal < 0 THEN RETURN false; END IF;

  SELECT COALESCE(SUM(reserved_decimal),0) INTO reserved_total
  FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;
  IF p_source_debit_decimal > reserved_total + 0.000000000000000001 THEN
    RAISE EXCEPTION 'authenticated source debit exceeds the provenance-backed treasury reservation';
  END IF;

  FOR row_lot IN
    SELECT tl.lot_id, tl.reserved_decimal, lot.remaining_decimal
    FROM public.cryptocrawler_system_capital_transfer_lots tl
    JOIN public.cryptocrawler_cex_system_owned_lots lot USING (lot_id)
    WHERE tl.transfer_id=p_transfer_id
    ORDER BY lot.created_at ASC, lot.lot_id ASC
    FOR UPDATE OF lot
  LOOP
    EXIT WHEN debit_remaining <= 0.000000000000000001;
    consume_amount := least(row_lot.reserved_decimal, debit_remaining);
    IF row_lot.remaining_decimal + 0.000000000000000001 < consume_amount THEN
      RAISE EXCEPTION 'reserved system-capital lot was consumed while treasury transfer was in flight';
    END IF;
    new_remaining := row_lot.remaining_decimal - consume_amount;
    UPDATE public.cryptocrawler_cex_system_owned_lots
    SET remaining_decimal=new_remaining,
        status=CASE WHEN new_remaining <= 0.000000000000000001 THEN 'CONSUMED' ELSE 'ACTIVE' END,
        updated_at=now()
    WHERE lot_id=row_lot.lot_id;
    debit_remaining := debit_remaining - consume_amount;
  END LOOP;
  IF debit_remaining > 0.000000000000000001 THEN
    RAISE EXCEPTION 'system-capital transfer could not apply the authenticated source debit exactly';
  END IF;

  IF transfer_row.target_kind='cex' THEN
    INSERT INTO public.cryptocrawler_cex_system_owned_lots (
      lot_id, idempotency_key, venue, asset, amount_decimal, remaining_decimal,
      status, origin_kind, origin_reference, opportunity_id, strategy,
      settlement_reference, settlement_evidence, authority_evidence,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      'cex-transfer:' || p_transfer_id::text,
      transfer_row.target_venue,
      transfer_row.asset,
      p_delivered_decimal,
      p_delivered_decimal,
      'ACTIVE',
      'CEX_TRANSFER',
      p_transfer_id::text,
      transfer_row.source_event_id,
      transfer_row.transfer_kind,
      COALESCE(NULLIF(trim(p_settlement_reference),''), p_transfer_id::text),
      COALESCE(p_evidence,'{}'::jsonb),
      jsonb_build_object(
        'sourceVenue', transfer_row.source_venue,
        'targetVenue', transfer_row.target_venue,
        'reservedMaximumDecimal', reserved_total,
        'authenticatedSourceDebitDecimal', p_source_debit_decimal,
        'deliveredDecimal', p_delivered_decimal,
        'sourceFeeDecimal', p_source_fee_decimal,
        'provenanceAuthority', 'cryptocrawler_system_capital_transfer_lots'
      ),
      now(), now()
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  UPDATE public.cryptocrawler_system_capital_transfers
  SET delivered_destination_decimal=p_delivered_decimal,
      source_fee_decimal=p_source_fee_decimal,
      status='CONFIRMED',
      destination_reference=COALESCE(NULLIF(trim(p_settlement_reference),''), destination_reference),
      transaction_hash=COALESCE(NULLIF(trim(p_transaction_hash),''), transaction_hash),
      destination_evidence=COALESCE(destination_evidence,'{}'::jsonb) || COALESCE(p_evidence,'{}'::jsonb),
      confirmed_at=COALESCE(confirmed_at,now()),
      updated_at=now(),
      last_error=NULL
  WHERE transfer_id=p_transfer_id;

  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE reservation_id='treasury:' || p_transfer_id::text;
  DELETE FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;
  RETURN true;
END;
$$;

ALTER TABLE public.cryptocrawler_payout_funding_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_payout_funding_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_payout_funding_transfers TO service_role;
REVOKE ALL ON FUNCTION public.cryptocrawler_gate_non_okx_payout_schedule() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_confirm_payout_funding_transfer(text,numeric,numeric,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer_exact(uuid,numeric,numeric,numeric,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_gate_non_okx_payout_schedule() TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_confirm_payout_funding_transfer(text,numeric,numeric,text,text,text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer_exact(uuid,numeric,numeric,numeric,text,text,jsonb) TO service_role;

COMMENT ON TABLE public.cryptocrawler_payout_funding_transfers IS
  'Terminal-profit payout capital moved from Kraken to OKX under the original payout reservation. Confirmation never promotes the payout capital into system-owned trading capital.';
COMMENT ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer_exact(uuid,numeric,numeric,numeric,text,text,jsonb) IS
  'Consumes only authenticated source debit from reserved system-owned lots, releases unused reservation, and creates a destination lot only after exchange-side terminal credit proof.';
