-- Treasury transfer reservations and canonical live-trade inventory reservations
-- must be mutually visible. This prevents retained routing, payout funding,
-- threshold sweeps and ordinary CEX execution from reserving the same physical
-- system-owned units through different ledgers.

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
  normalized_venue text := lower(trim(p_source_venue));
  normalized_asset text := upper(trim(p_asset));
  needed numeric := p_amount;
  available_for_lot numeric;
  already_reserved numeric;
  inventory_reserved numeric := 0;
  total_system_owned numeric := 0;
  total_transfer_reserved numeric := 0;
  take_amount numeric;
  reservation_key text := 'treasury:' || p_transfer_id::text;
  row_lot record;
BEGIN
  IF p_transfer_id IS NULL OR normalized_venue NOT IN ('kraken','okx') OR normalized_asset='' OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cryptocrawler_system_capital_transfers
    WHERE transfer_id=p_transfer_id
      AND source_venue=normalized_venue
      AND asset=normalized_asset
      AND status IN ('PREPARED','RETRYABLE')
  ) THEN
    RETURN 0;
  END IF;

  DELETE FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;
  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE reservation_id=reservation_key;
  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE expires_at <= now();

  SELECT COALESCE(SUM(remaining_decimal),0)
    INTO total_system_owned
  FROM public.cryptocrawler_cex_system_owned_lots
  WHERE venue=normalized_venue AND asset=normalized_asset
    AND status='ACTIVE' AND remaining_decimal > 0;

  SELECT COALESCE(SUM(tl.reserved_decimal),0)
    INTO total_transfer_reserved
  FROM public.cryptocrawler_system_capital_transfer_lots tl
  JOIN public.cryptocrawler_system_capital_transfers t ON t.transfer_id=tl.transfer_id
  JOIN public.cryptocrawler_cex_system_owned_lots lot ON lot.lot_id=tl.lot_id
  WHERE lot.venue=normalized_venue AND lot.asset=normalized_asset
    AND tl.transfer_id<>p_transfer_id
    AND t.status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE','MANUAL_REVIEW');

  SELECT COALESCE(SUM(amount),0)
    INTO inventory_reserved
  FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE venue=normalized_venue AND asset=normalized_asset
    AND expires_at > now()
    AND reservation_id<>reservation_key;

  IF total_system_owned - total_transfer_reserved - inventory_reserved + 0.000000000000000001 < p_amount THEN
    RETURN 0;
  END IF;

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
    p_amount,
    now(),
    now() + interval '6 hours'
  );

  UPDATE public.cryptocrawler_system_capital_transfers
  SET status='PREPARED', updated_at=now(), last_error=NULL
  WHERE transfer_id=p_transfer_id;
  RETURN p_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_release_system_capital_transfer(p_transfer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed integer := 0;
BEGIN
  UPDATE public.cryptocrawler_system_capital_transfers
  SET status='RELEASED', updated_at=now()
  WHERE transfer_id=p_transfer_id AND status IN ('PREPARED','RETRYABLE');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed=1 THEN
    DELETE FROM public.cryptocrawler_system_capital_transfer_lots WHERE transfer_id=p_transfer_id;
    DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1
    WHERE reservation_id='treasury:' || p_transfer_id::text;
  END IF;
  RETURN changed=1;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid) TO service_role;

COMMENT ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) IS
  'Atomically reserves settlement-derived lots and mirrors the same amount into canonical CEX inventory reservations so trade and treasury authorities cannot double-reserve capital.';
