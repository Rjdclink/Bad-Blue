-- Final truth hardening for normal-runtime treasury transfers and threshold sweeps.
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

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
  epsilon numeric := 0.000000000000000001;
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
  IF p_source_fee_decimal > p_source_debit_decimal + epsilon THEN
    RAISE EXCEPTION 'authenticated treasury fee exceeds authenticated source debit';
  END IF;
  IF p_source_debit_decimal > transfer_row.requested_source_decimal + epsilon THEN
    RAISE EXCEPTION 'authenticated source debit exceeds the durable treasury transfer maximum';
  END IF;

  IF transfer_row.target_kind='wallet' THEN
    IF abs(p_delivered_decimal - transfer_row.requested_destination_decimal) > greatest(epsilon, transfer_row.requested_destination_decimal * 0.000000001) THEN
      RAISE EXCEPTION 'wallet-delivered treasury amount differs from the persisted wallet target';
    END IF;
    IF p_transaction_hash IS NULL OR length(trim(p_transaction_hash))=0 THEN
      RAISE EXCEPTION 'wallet treasury confirmation requires a recipient-bound transaction hash';
    END IF;
  ELSIF transfer_row.target_kind='cex' THEN
    IF p_delivered_decimal + greatest(epsilon, transfer_row.requested_destination_decimal * 0.000000001) < transfer_row.requested_destination_decimal THEN
      RAISE EXCEPTION 'destination exchange credited less than the persisted treasury transfer target';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported treasury transfer target kind %', transfer_row.target_kind;
  END IF;

  SELECT COALESCE(SUM(reserved_decimal),0) INTO reserved_total
  FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;
  IF p_source_debit_decimal > reserved_total + epsilon THEN
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
    EXIT WHEN debit_remaining <= epsilon;
    consume_amount := least(row_lot.reserved_decimal, debit_remaining);
    IF row_lot.remaining_decimal + epsilon < consume_amount THEN
      RAISE EXCEPTION 'reserved system-capital lot was consumed while treasury transfer was in flight';
    END IF;
    new_remaining := row_lot.remaining_decimal - consume_amount;
    UPDATE public.cryptocrawler_cex_system_owned_lots
    SET remaining_decimal=new_remaining,
        status=CASE WHEN new_remaining <= epsilon THEN 'CONSUMED' ELSE 'ACTIVE' END,
        updated_at=now()
    WHERE lot_id=row_lot.lot_id;
    debit_remaining := debit_remaining - consume_amount;
  END LOOP;
  IF debit_remaining > epsilon THEN
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

REVOKE ALL ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer_exact(uuid,numeric,numeric,numeric,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer_exact(uuid,numeric,numeric,numeric,text,text,jsonb) TO service_role;

COMMENT ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer_exact(uuid,numeric,numeric,numeric,text,text,jsonb) IS
  'Consumes only the authenticated source debit. CEX targets must receive at least their persisted destination amount; wallet targets must match the persisted target and include recipient-bound transaction evidence.';

-- Treasury and system-sweep reservations are lifecycle-bound, not TTL-bound.
-- A transfer/order may remain unresolved longer than an arbitrary process timer;
-- only explicit terminal confirmation/release may make those units spendable again.
CREATE OR REPLACE FUNCTION public.cryptocrawler_guard_treasury_inventory_reservation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reservation_id LIKE 'treasury:%'
     OR COALESCE(NEW.opportunity_id,'') LIKE 'system-sweep:%' THEN
    NEW.expires_at := 'infinity'::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_guard_treasury_inventory_reservation_lifecycle
  ON public.cryptocrawler_cex_inventory_reservations_v1;
CREATE TRIGGER trg_cryptocrawler_guard_treasury_inventory_reservation_lifecycle
BEFORE INSERT OR UPDATE OF expires_at, reservation_id, opportunity_id
ON public.cryptocrawler_cex_inventory_reservations_v1
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_guard_treasury_inventory_reservation_lifecycle();

UPDATE public.cryptocrawler_cex_inventory_reservations_v1 r
SET expires_at='infinity'::timestamptz
WHERE r.reservation_id LIKE 'treasury:%'
   OR r.opportunity_id LIKE 'system-sweep:%';

COMMENT ON FUNCTION public.cryptocrawler_guard_treasury_inventory_reservation_lifecycle() IS
  'Prevents unresolved treasury transfers and threshold-sweep conversions from becoming spendable because an arbitrary reservation TTL elapsed.';

-- If a sweep has a possibly-submitted wallet transfer, a generic transient error
-- must not send the batch back into conversion planning. Keep it in SUBMITTED so
-- the next pass reconciles the deterministic withdrawal intent before any new move.
CREATE OR REPLACE FUNCTION public.cryptocrawler_preserve_submitted_sweep_recovery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status='RETRYABLE'
     AND NEW.wallet_transfer_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.cryptocrawler_system_capital_transfers t
       WHERE t.transfer_id=NEW.wallet_transfer_id
         AND t.status IN ('SUBMITTED','SETTLING')
     ) THEN
    NEW.status := 'SUBMITTED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_preserve_submitted_sweep_recovery
  ON public.cryptocrawler_system_capital_sweep_batches;
CREATE TRIGGER trg_cryptocrawler_preserve_submitted_sweep_recovery
BEFORE UPDATE OF status
ON public.cryptocrawler_system_capital_sweep_batches
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_preserve_submitted_sweep_recovery();

COMMENT ON FUNCTION public.cryptocrawler_preserve_submitted_sweep_recovery() IS
  'Forces recover-before-resubmit after an ambiguous or interrupted wallet withdrawal instead of allowing a second conversion plan to start.';

-- Runtime schema verification historically named a two-argument release signature.
-- Keep that compatibility surface as a non-authoritative delegate to the canonical
-- one-argument release function; the reason text never changes release semantics.
CREATE OR REPLACE FUNCTION public.cryptocrawler_release_system_capital_transfer(
  p_transfer_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.cryptocrawler_release_system_capital_transfer(p_transfer_id);
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid,text) TO service_role;

COMMENT ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid,text) IS
  'Compatibility delegate for the canonical lifecycle-bound treasury release function; the reason parameter is descriptive only.';
