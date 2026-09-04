-- Treasury transfer recovery hardening.
-- Once a money-moving transfer has crossed submission, its provenance reservation
-- becomes immutable recovery state. Retries must reconcile the original durable
-- intent; they may not requote, rebuild, release, or downgrade that reservation as
-- though the transfer had never been submitted.

CREATE OR REPLACE FUNCTION public.cryptocrawler_reserve_system_capital_transfer(
  p_transfer_id uuid,
  p_source_venue text,
  p_asset text,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_row record;
  normalized_venue text := lower(trim(p_source_venue));
  normalized_asset text := upper(trim(p_asset));
  reservation_key text := 'treasury:' || p_transfer_id::text;
  existing_lot_reserved numeric := 0;
  existing_inventory_reserved numeric := 0;
  total_system_owned numeric := 0;
  total_transfer_reserved numeric := 0;
  inventory_reserved_elsewhere numeric := 0;
  needed numeric;
  available_for_lot numeric;
  already_reserved numeric;
  take_amount numeric;
  row_lot record;
BEGIN
  IF p_transfer_id IS NULL
     OR normalized_venue NOT IN ('coinbase','kraken','okx')
     OR normalized_asset=''
     OR p_amount IS NULL
     OR p_amount <= 0 THEN
    RETURN 0;
  END IF;

  SELECT * INTO transfer_row
  FROM public.cryptocrawler_system_capital_transfers
  WHERE transfer_id=p_transfer_id
  FOR UPDATE;

  IF transfer_row IS NULL THEN RETURN 0; END IF;
  IF transfer_row.source_venue<>normalized_venue OR transfer_row.asset<>normalized_asset THEN
    RAISE EXCEPTION 'treasury transfer recovery identity differs from durable venue/asset intent';
  END IF;
  IF abs(transfer_row.requested_source_decimal - p_amount) > 0.000000000000000001 THEN
    RAISE EXCEPTION 'treasury transfer recovery amount differs from durable requested source debit';
  END IF;

  -- CONFIRMED is terminal ownership truth. Reservation APIs never downgrade it.
  IF transfer_row.status='CONFIRMED' THEN RETURN 0; END IF;
  IF transfer_row.status='RELEASED' THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(reserved_decimal),0)
    INTO existing_lot_reserved
  FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;

  SELECT COALESCE(SUM(amount),0)
    INTO existing_inventory_reserved
  FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE reservation_id=reservation_key
    AND venue=normalized_venue
    AND asset=normalized_asset
    AND expires_at > now();

  -- Any state that may already have crossed the provider submission boundary is
  -- recovery-only. Exact reservations are returned unchanged; missing or altered
  -- reservations force MANUAL_REVIEW instead of manufacturing fresh authority.
  IF transfer_row.status IN ('SUBMITTED','SETTLING','MANUAL_REVIEW')
     OR (transfer_row.status='RETRYABLE' AND transfer_row.submitted_at IS NOT NULL) THEN
    IF abs(existing_lot_reserved - transfer_row.requested_source_decimal) <= 0.000000000000000001
       AND abs(existing_inventory_reserved - transfer_row.requested_source_decimal) <= 0.000000000000000001 THEN
      RETURN transfer_row.requested_source_decimal;
    END IF;

    UPDATE public.cryptocrawler_system_capital_transfers
    SET status='MANUAL_REVIEW',
        last_error=COALESCE(last_error,'ambiguous treasury transfer lost or drifted its immutable provenance reservation; automatic resubmission forbidden'),
        updated_at=now()
    WHERE transfer_id=p_transfer_id AND status<>'CONFIRMED';
    RETURN 0;
  END IF;

  IF transfer_row.status NOT IN ('PREPARED','RETRYABLE') THEN RETURN 0; END IF;

  -- A pre-submission exact reservation is idempotent as-is.
  IF abs(existing_lot_reserved - transfer_row.requested_source_decimal) <= 0.000000000000000001
     AND abs(existing_inventory_reserved - transfer_row.requested_source_decimal) <= 0.000000000000000001 THEN
    RETURN transfer_row.requested_source_decimal;
  END IF;

  -- Only never-submitted preparation may rebuild an incomplete reservation.
  IF transfer_row.submitted_at IS NOT NULL THEN
    UPDATE public.cryptocrawler_system_capital_transfers
    SET status='MANUAL_REVIEW',
        last_error=COALESCE(last_error,'submitted treasury transfer cannot rebuild provenance reservation'),
        updated_at=now()
    WHERE transfer_id=p_transfer_id AND status<>'CONFIRMED';
    RETURN 0;
  END IF;

  DELETE FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;
  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE reservation_id=reservation_key;
  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE expires_at <= now()
    AND reservation_id NOT LIKE 'treasury:%';

  SELECT COALESCE(SUM(remaining_decimal),0)
    INTO total_system_owned
  FROM public.cryptocrawler_cex_system_owned_lots
  WHERE venue=normalized_venue
    AND asset=normalized_asset
    AND status='ACTIVE'
    AND remaining_decimal > 0;

  SELECT COALESCE(SUM(tl.reserved_decimal),0)
    INTO total_transfer_reserved
  FROM public.cryptocrawler_system_capital_transfer_lots tl
  JOIN public.cryptocrawler_system_capital_transfers t ON t.transfer_id=tl.transfer_id
  JOIN public.cryptocrawler_cex_system_owned_lots lot ON lot.lot_id=tl.lot_id
  WHERE lot.venue=normalized_venue
    AND lot.asset=normalized_asset
    AND tl.transfer_id<>p_transfer_id
    AND t.status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE','MANUAL_REVIEW');

  SELECT COALESCE(SUM(amount),0)
    INTO inventory_reserved_elsewhere
  FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE venue=normalized_venue
    AND asset=normalized_asset
    AND expires_at > now()
    AND reservation_id<>reservation_key;

  IF total_system_owned - total_transfer_reserved - inventory_reserved_elsewhere + 0.000000000000000001
       < transfer_row.requested_source_decimal THEN
    RETURN 0;
  END IF;

  needed := transfer_row.requested_source_decimal;
  FOR row_lot IN
    SELECT lot_id, remaining_decimal
    FROM public.cryptocrawler_cex_system_owned_lots
    WHERE venue=normalized_venue
      AND asset=normalized_asset
      AND status='ACTIVE'
      AND remaining_decimal > 0
    ORDER BY created_at ASC, lot_id ASC
    FOR UPDATE
  LOOP
    SELECT COALESCE(SUM(tl.reserved_decimal),0)
      INTO already_reserved
    FROM public.cryptocrawler_system_capital_transfer_lots tl
    JOIN public.cryptocrawler_system_capital_transfers t ON t.transfer_id=tl.transfer_id
    WHERE tl.lot_id=row_lot.lot_id
      AND tl.transfer_id<>p_transfer_id
      AND t.status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE','MANUAL_REVIEW');

    available_for_lot := greatest(0, row_lot.remaining_decimal - already_reserved);
    IF available_for_lot <= 0 THEN CONTINUE; END IF;
    take_amount := least(available_for_lot, needed);
    IF take_amount <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.cryptocrawler_system_capital_transfer_lots
      (transfer_id, lot_id, reserved_decimal, created_at)
    VALUES (p_transfer_id, row_lot.lot_id, take_amount, now());

    needed := needed - take_amount;
    EXIT WHEN needed <= 0.000000000000000001;
  END LOOP;

  IF needed > 0.000000000000000001 THEN
    DELETE FROM public.cryptocrawler_system_capital_transfer_lots WHERE transfer_id=p_transfer_id;
    RETURN 0;
  END IF;

  INSERT INTO public.cryptocrawler_cex_inventory_reservations_v1
    (reservation_id, opportunity_id, venue, asset, amount, acquired_at, expires_at)
  VALUES (
    reservation_key,
    'treasury-transfer:' || p_transfer_id::text,
    normalized_venue,
    normalized_asset,
    transfer_row.requested_source_decimal,
    now(),
    'infinity'::timestamptz
  )
  ON CONFLICT (reservation_id, venue, asset) DO UPDATE SET
    amount=EXCLUDED.amount,
    expires_at='infinity'::timestamptz;

  UPDATE public.cryptocrawler_system_capital_transfers
  SET status='PREPARED', updated_at=now(), last_error=NULL
  WHERE transfer_id=p_transfer_id
    AND status IN ('PREPARED','RETRYABLE')
    AND submitted_at IS NULL;

  RETURN transfer_row.requested_source_decimal;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_release_system_capital_transfer(p_transfer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_row record;
BEGIN
  SELECT * INTO transfer_row
  FROM public.cryptocrawler_system_capital_transfers
  WHERE transfer_id=p_transfer_id
  FOR UPDATE;

  IF transfer_row IS NULL THEN RETURN false; END IF;
  IF transfer_row.status NOT IN ('PREPARED','RETRYABLE') THEN RETURN false; END IF;
  IF transfer_row.submitted_at IS NOT NULL THEN RETURN false; END IF;

  UPDATE public.cryptocrawler_system_capital_transfers
  SET status='RELEASED', updated_at=now()
  WHERE transfer_id=p_transfer_id
    AND status IN ('PREPARED','RETRYABLE')
    AND submitted_at IS NULL;

  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;
  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE reservation_id='treasury:' || p_transfer_id::text;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid) TO service_role;

COMMENT ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) IS
  'Idempotent provenance reservation authority: submitted/ambiguous transfers preserve their exact durable reservation and may never rebuild it before reconciliation.';
COMMENT ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid) IS
  'Releases provenance only before any provider submission; submitted/ambiguous/confirmed transfer reservations are immutable recovery state.';
