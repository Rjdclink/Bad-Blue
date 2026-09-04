-- Coinbase end-to-end system-capital/Rainbow support.
-- Account-wide Coinbase balances remain reconciliation ceilings only. Spendability
-- is created exclusively by exact settlement-derived/system-deposit lots.

ALTER TABLE public.cryptocrawler_cex_system_owned_lots
  DROP CONSTRAINT IF EXISTS cryptocrawler_cex_system_owned_lots_venue_check;
ALTER TABLE public.cryptocrawler_cex_system_owned_lots
  ADD CONSTRAINT cryptocrawler_cex_system_owned_lots_venue_check
  CHECK (venue IN ('coinbase','kraken','okx'));

ALTER TABLE public.cryptocrawler_cex_system_owned_settlements
  DROP CONSTRAINT IF EXISTS cryptocrawler_cex_system_owned_settlements_venue_check;
ALTER TABLE public.cryptocrawler_cex_system_owned_settlements
  ADD CONSTRAINT cryptocrawler_cex_system_owned_settlements_venue_check
  CHECK (venue IN ('coinbase','kraken','okx'));

ALTER TABLE public.cryptocrawler_retained_exchange_allocations
  DROP CONSTRAINT IF EXISTS cryptocrawler_retained_exchange_allocations_target_venue_check;
ALTER TABLE public.cryptocrawler_retained_exchange_allocations
  ADD CONSTRAINT cryptocrawler_retained_exchange_allocations_target_venue_check
  CHECK (target_venue IN ('coinbase','kraken','okx'));

ALTER TABLE public.cryptocrawler_system_capital_transfers
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_transfers_source_venue_check;
ALTER TABLE public.cryptocrawler_system_capital_transfers
  ADD CONSTRAINT cryptocrawler_system_capital_transfers_source_venue_check
  CHECK (source_venue IN ('coinbase','kraken','okx'));
ALTER TABLE public.cryptocrawler_system_capital_transfers
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_transfers_target_venue_check;
ALTER TABLE public.cryptocrawler_system_capital_transfers
  ADD CONSTRAINT cryptocrawler_system_capital_transfers_target_venue_check
  CHECK (target_venue IS NULL OR target_venue IN ('coinbase','kraken','okx'));

ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  DROP CONSTRAINT IF EXISTS cryptocrawler_system_capital_sweep_batches_venue_check;
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches
  ADD CONSTRAINT cryptocrawler_system_capital_sweep_batches_venue_check
  CHECK (venue IN ('coinbase','kraken','okx'));

ALTER TABLE public.cryptocrawler_payout_funding_transfers
  DROP CONSTRAINT IF EXISTS cryptocrawler_payout_funding_transfers_source_venue_check;
ALTER TABLE public.cryptocrawler_payout_funding_transfers
  ADD CONSTRAINT cryptocrawler_payout_funding_transfers_source_venue_check
  CHECK (source_venue IN ('coinbase','kraken'));

CREATE OR REPLACE FUNCTION private.cryptocrawler_seed_cex_system_owned_lot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  delivered numeric(78,36);
  divisor numeric(78,36);
  exact_amount numeric(78,36);
  spendable_authority boolean;
BEGIN
  IF NEW.destination_kind <> 'cex' OR NEW.status <> 'PLACED' THEN RETURN NEW; END IF;
  IF OLD.status = 'PLACED' THEN RETURN NEW; END IF;
  IF lower(COALESCE(NEW.destination_venue, '')) NOT IN ('coinbase','kraken','okx') THEN
    RAISE EXCEPTION 'System-owned CEX lot cannot be created for venue %', COALESCE(NEW.destination_venue, 'missing');
  END IF;
  IF NEW.delivered_amount_base_units IS NULL OR NEW.destination_asset_decimals IS NULL THEN
    RAISE EXCEPTION 'PLACED CEX allocation requires exact delivered base units and decimals';
  END IF;

  spendable_authority := COALESCE((NEW.placement_evidence->>'tradingAccountSpendableAuthority')::boolean, false);
  IF lower(NEW.destination_venue) IN ('coinbase','okx') AND spendable_authority IS DISTINCT FROM true THEN
    RAISE EXCEPTION '% PLACED allocation lacks authenticated trading-account spendability evidence', upper(NEW.destination_venue);
  END IF;

  delivered := NEW.delivered_amount_base_units::numeric;
  divisor := power(10::numeric, NEW.destination_asset_decimals);
  exact_amount := delivered / divisor;
  IF exact_amount <= 0 THEN RAISE EXCEPTION 'PLACED CEX allocation delivered amount must be positive'; END IF;

  INSERT INTO public.cryptocrawler_cex_system_owned_lots (
    lot_id, idempotency_key, venue, asset, amount_decimal, remaining_decimal,
    status, origin_kind, origin_reference, parent_allocation_id,
    opportunity_id, strategy, settlement_reference, settlement_evidence,
    authority_evidence
  ) VALUES (
    gen_random_uuid(), 'system-deposit:' || NEW.allocation_id,
    lower(NEW.destination_venue), upper(NEW.destination_asset), exact_amount, exact_amount,
    'ACTIVE', 'SYSTEM_DEPOSIT', NEW.allocation_id, NEW.allocation_id,
    NEW.opportunity_id, NEW.strategy,
    COALESCE(NULLIF(NEW.placement_reference, ''), NEW.allocation_id),
    COALESCE(NEW.placement_evidence, '{}'::jsonb),
    COALESCE(NEW.authority_evidence, '{}'::jsonb)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Coinbase and every other CEX use one provenance-reservation authority.
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
  IF p_transfer_id IS NULL OR normalized_venue NOT IN ('coinbase','kraken','okx') OR normalized_asset='' OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cryptocrawler_system_capital_transfers
    WHERE transfer_id=p_transfer_id AND source_venue=normalized_venue AND asset=normalized_asset
      AND status IN ('PREPARED','RETRYABLE')
  ) THEN RETURN 0; END IF;

  DELETE FROM public.cryptocrawler_system_capital_transfer_lots WHERE transfer_id=p_transfer_id;
  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1 WHERE reservation_id=reservation_key;
  DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1 WHERE expires_at <= now();

  SELECT COALESCE(SUM(remaining_decimal),0) INTO total_system_owned
  FROM public.cryptocrawler_cex_system_owned_lots
  WHERE venue=normalized_venue AND asset=normalized_asset AND status='ACTIVE' AND remaining_decimal > 0;

  SELECT COALESCE(SUM(tl.reserved_decimal),0) INTO total_transfer_reserved
  FROM public.cryptocrawler_system_capital_transfer_lots tl
  JOIN public.cryptocrawler_system_capital_transfers t ON t.transfer_id=tl.transfer_id
  JOIN public.cryptocrawler_cex_system_owned_lots lot ON lot.lot_id=tl.lot_id
  WHERE lot.venue=normalized_venue AND lot.asset=normalized_asset AND tl.transfer_id<>p_transfer_id
    AND t.status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE','MANUAL_REVIEW');

  SELECT COALESCE(SUM(amount),0) INTO inventory_reserved
  FROM public.cryptocrawler_cex_inventory_reservations_v1
  WHERE venue=normalized_venue AND asset=normalized_asset AND expires_at > now()
    AND reservation_id<>reservation_key;

  IF total_system_owned - total_transfer_reserved - inventory_reserved + 0.000000000000000001 < p_amount THEN RETURN 0; END IF;

  FOR row_lot IN
    SELECT lot_id, remaining_decimal FROM public.cryptocrawler_cex_system_owned_lots
    WHERE venue=normalized_venue AND asset=normalized_asset AND status='ACTIVE' AND remaining_decimal > 0
    ORDER BY created_at ASC, lot_id ASC FOR UPDATE
  LOOP
    SELECT COALESCE(SUM(tl.reserved_decimal),0) INTO already_reserved
    FROM public.cryptocrawler_system_capital_transfer_lots tl
    JOIN public.cryptocrawler_system_capital_transfers t ON t.transfer_id=tl.transfer_id
    WHERE tl.lot_id=row_lot.lot_id AND tl.transfer_id<>p_transfer_id
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
  VALUES (reservation_key, 'treasury-transfer:' || p_transfer_id::text,
          normalized_venue, normalized_asset, p_amount, now(), 'infinity'::timestamptz);

  UPDATE public.cryptocrawler_system_capital_transfers
  SET status='PREPARED', updated_at=now(), last_error=NULL WHERE transfer_id=p_transfer_id;
  RETURN p_amount;
END;
$$;

-- Both Kraken and Coinbase payout sources must be physically routed to the one
-- existing OKX ETH payout executor before that executor is allowed to consume them.
CREATE OR REPLACE FUNCTION public.cryptocrawler_gate_non_okx_payout_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(COALESCE(NEW.source_venue,'')) IN ('coinbase','kraken')
     AND NEW.status IN ('QUEUED','RETRYABLE') THEN
    NEW.scheduled_not_before := 'infinity'::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;

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
  SELECT * INTO funding_row FROM public.cryptocrawler_payout_funding_transfers
  WHERE event_id=p_event_id FOR UPDATE;
  IF funding_row IS NULL THEN RETURN false; END IF;
  IF funding_row.status='CONFIRMED' THEN RETURN true; END IF;
  IF funding_row.status NOT IN ('SUBMITTED','SETTLING') THEN RETURN false; END IF;
  IF funding_row.source_venue NOT IN ('coinbase','kraken') OR funding_row.target_venue<>'okx' THEN
    RAISE EXCEPTION 'payout funding transfer has unsupported venue route';
  END IF;
  IF p_delivered_decimal IS NULL OR p_delivered_decimal <= 0 OR p_source_fee_decimal IS NULL OR p_source_fee_decimal < 0 THEN RETURN false; END IF;

  SELECT * INTO reservation_row FROM public.cryptocrawler_payout_asset_reservations
  WHERE event_id=p_event_id FOR UPDATE;
  IF reservation_row IS NULL OR lower(reservation_row.venue)<>funding_row.source_venue THEN
    RAISE EXCEPTION 'payout funding confirmation requires the original terminal-profit asset reservation';
  END IF;
  IF p_delivered_decimal + 0.000000001 < reservation_row.remaining_asset_amount THEN
    RAISE EXCEPTION 'OKX delivered payout funding is below the durable reserved payout amount';
  END IF;

  UPDATE public.cryptocrawler_payout_funding_transfers
  SET delivered_destination_decimal=p_delivered_decimal, source_fee_decimal=p_source_fee_decimal,
      status='CONFIRMED',
      withdrawal_reference=COALESCE(NULLIF(trim(p_withdrawal_reference),''), withdrawal_reference),
      transaction_hash=COALESCE(NULLIF(trim(p_transaction_hash),''), transaction_hash),
      destination_reference=COALESCE(NULLIF(trim(p_destination_reference),''), destination_reference),
      source_evidence=COALESCE(source_evidence,'{}'::jsonb) || COALESCE(p_source_evidence,'{}'::jsonb),
      destination_evidence=COALESCE(destination_evidence,'{}'::jsonb) || COALESCE(p_destination_evidence,'{}'::jsonb),
      confirmed_at=COALESCE(confirmed_at,now()), updated_at=now(), last_error=NULL
  WHERE event_id=p_event_id;

  UPDATE public.cryptocrawler_payout_asset_reservations
  SET venue='okx', status='HELD', updated_at=now() WHERE event_id=p_event_id;
  UPDATE public.cryptocrawler_profit_payout_jobs
  SET source_venue='okx', source_asset=funding_row.asset, scheduled_not_before=now(),
      status=CASE WHEN status='RETRYABLE' THEN 'QUEUED' ELSE status END,
      last_error=NULL, updated_at=now()
  WHERE event_id=p_event_id AND status NOT IN ('CONFIRMED','TERMINAL_SWEPT','MANUAL_REVIEW');
  RETURN true;
END;
$$;

-- Backfill only already-confirmed placements. Coinbase/OKX require explicit
-- authenticated proof that exact delivered units are spendable by trading.
INSERT INTO public.cryptocrawler_cex_system_owned_lots (
  lot_id, idempotency_key, venue, asset, amount_decimal, remaining_decimal,
  status, origin_kind, origin_reference, parent_allocation_id,
  opportunity_id, strategy, settlement_reference, settlement_evidence,
  authority_evidence
)
SELECT
  gen_random_uuid(), 'system-deposit:' || allocation_id, lower(destination_venue), upper(destination_asset),
  delivered_amount_base_units::numeric / power(10::numeric, destination_asset_decimals),
  delivered_amount_base_units::numeric / power(10::numeric, destination_asset_decimals),
  'ACTIVE', 'SYSTEM_DEPOSIT', allocation_id, allocation_id, opportunity_id, strategy,
  COALESCE(NULLIF(placement_reference, ''), allocation_id),
  COALESCE(placement_evidence, '{}'::jsonb), COALESCE(authority_evidence, '{}'::jsonb)
FROM public.cryptocrawler_system_capital_allocations
WHERE destination_kind='cex' AND status='PLACED'
  AND lower(COALESCE(destination_venue,'')) IN ('coinbase','kraken','okx')
  AND delivered_amount_base_units IS NOT NULL
  AND (lower(destination_venue)='kraken'
       OR COALESCE((placement_evidence->>'tradingAccountSpendableAuthority')::boolean, false)=true)
ON CONFLICT (idempotency_key) DO NOTHING;

REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_gate_non_okx_payout_schedule() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_confirm_payout_funding_transfer(text,numeric,numeric,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_gate_non_okx_payout_schedule() TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_confirm_payout_funding_transfer(text,numeric,numeric,text,text,text,jsonb,jsonb) TO service_role;

COMMENT ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) IS
  'One provenance-backed CEX transfer reservation authority across Coinbase/Kraken/OKX; account-wide balances never create spend authority.';
