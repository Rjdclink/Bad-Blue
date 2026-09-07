-- Coinbase Advanced Trade can participate in system-owned execution only after
-- authenticated terminal order/fill evidence proves exact asset deltas. This
-- migration widens the canonical ownership tables and placement seed trigger;
-- account balances never create ownership.

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

-- Replace migration 027's deposit-to-owned-lot trigger. Coinbase and OKX both
-- require explicit destination spendability proof before PLACED capital can mint
-- an ACTIVE ownership lot. Kraken keeps its existing fail-closed placement lane.
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
  IF NEW.destination_kind <> 'cex' OR NEW.status <> 'PLACED' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'PLACED' THEN
    RETURN NEW;
  END IF;
  IF lower(COALESCE(NEW.destination_venue, '')) NOT IN ('coinbase','kraken','okx') THEN
    RAISE EXCEPTION 'System-owned CEX lot cannot be created for venue %', COALESCE(NEW.destination_venue, 'missing');
  END IF;
  IF NEW.delivered_amount_base_units IS NULL OR NEW.destination_asset_decimals IS NULL THEN
    RAISE EXCEPTION 'PLACED CEX allocation requires exact delivered base units and decimals';
  END IF;

  spendable_authority := COALESCE((NEW.placement_evidence->>'tradingAccountSpendableAuthority')::boolean, false);
  IF lower(NEW.destination_venue) IN ('coinbase','okx') AND spendable_authority IS DISTINCT FROM true THEN
    RAISE EXCEPTION '% PLACED allocation lacks destination spendability evidence', upper(NEW.destination_venue);
  END IF;

  delivered := NEW.delivered_amount_base_units::numeric;
  divisor := power(10::numeric, NEW.destination_asset_decimals);
  exact_amount := delivered / divisor;
  IF exact_amount <= 0 THEN
    RAISE EXCEPTION 'PLACED CEX allocation delivered amount must be positive';
  END IF;

  INSERT INTO public.cryptocrawler_cex_system_owned_lots (
    lot_id, idempotency_key, venue, asset, amount_decimal, remaining_decimal,
    status, origin_kind, origin_reference, parent_allocation_id,
    opportunity_id, strategy, settlement_reference, settlement_evidence,
    authority_evidence
  ) VALUES (
    gen_random_uuid(),
    'system-deposit:' || NEW.allocation_id,
    lower(NEW.destination_venue),
    upper(NEW.destination_asset),
    exact_amount,
    exact_amount,
    'ACTIVE',
    'SYSTEM_DEPOSIT',
    NEW.allocation_id,
    NEW.allocation_id,
    NEW.opportunity_id,
    NEW.strategy,
    COALESCE(NULLIF(NEW.placement_reference, ''), NEW.allocation_id),
    COALESCE(NEW.placement_evidence, '{}'::jsonb),
    COALESCE(NEW.authority_evidence, '{}'::jsonb)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Idempotent backfill for any already-confirmed Coinbase placement produced by a
-- concurrent deploy before this trigger replacement. Only rows carrying explicit
-- spendability authority qualify; balance observations alone never do.
INSERT INTO public.cryptocrawler_cex_system_owned_lots (
  lot_id, idempotency_key, venue, asset, amount_decimal, remaining_decimal,
  status, origin_kind, origin_reference, parent_allocation_id,
  opportunity_id, strategy, settlement_reference, settlement_evidence,
  authority_evidence
)
SELECT
  gen_random_uuid(),
  'system-deposit:' || allocation_id,
  lower(destination_venue),
  upper(destination_asset),
  delivered_amount_base_units::numeric / power(10::numeric, destination_asset_decimals),
  delivered_amount_base_units::numeric / power(10::numeric, destination_asset_decimals),
  'ACTIVE',
  'SYSTEM_DEPOSIT',
  allocation_id,
  allocation_id,
  opportunity_id,
  strategy,
  COALESCE(NULLIF(placement_reference, ''), allocation_id),
  COALESCE(placement_evidence, '{}'::jsonb),
  COALESCE(authority_evidence, '{}'::jsonb)
FROM public.cryptocrawler_system_capital_allocations
WHERE destination_kind='cex'
  AND status='PLACED'
  AND lower(COALESCE(destination_venue,''))='coinbase'
  AND delivered_amount_base_units IS NOT NULL
  AND COALESCE((placement_evidence->>'tradingAccountSpendableAuthority')::boolean, false)=true
ON CONFLICT (idempotency_key) DO NOTHING;

COMMENT ON TABLE public.cryptocrawler_cex_system_owned_lots IS
  'Exact decimal ownership lots for system-generated CEX capital on Coinbase, Kraken, and OKX. Authenticated account balances never create rows; only settlement-confirmed system deposits/trades/rebates/funding outcomes may create ownership.';
COMMENT ON TABLE public.cryptocrawler_cex_system_owned_settlements IS
  'Idempotency boundary for exact Coinbase/Kraken/OKX ownership transformations. A terminal order may consume/create system-owned lots at most once.';
