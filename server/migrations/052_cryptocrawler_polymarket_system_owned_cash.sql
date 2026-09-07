-- Polymarket system-owned collateral authority.
-- Authenticated Polymarket account balance is capacity evidence only. Ownership
-- is created only from an exact system-capital allocation that was physically
-- placed on Polymarket, or from authenticated terminal system P/L.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_polymarket_system_owned_cash_lots (
  lot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  amount_usd numeric(78,36) NOT NULL CHECK (amount_usd > 0),
  remaining_usd numeric(78,36) NOT NULL CHECK (remaining_usd >= 0 AND remaining_usd <= amount_usd),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','QUARANTINED')),
  origin_kind text NOT NULL CHECK (origin_kind IN (
    'SYSTEM_TRANSFER','REALIZED_EVENT','MAKER_REBATE','FEE_REFUND','INCENTIVE_REWARD','OTHER_VERIFIED_SYSTEM_PROFIT'
  )),
  origin_reference text NOT NULL,
  parent_allocation_id text REFERENCES public.cryptocrawler_system_capital_allocations(allocation_id),
  opportunity_id text,
  strategy text,
  settlement_reference text NOT NULL,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_polymarket_cash_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lifecycle_id text NOT NULL,
  opportunity_id text NOT NULL,
  amount_usd numeric(78,36) NOT NULL CHECK (amount_usd > 0),
  status text NOT NULL CHECK (status IN ('HELD','RELEASED','QUARANTINED')),
  expires_at timestamptz NOT NULL,
  authority_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lifecycle_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_polymarket_cash_settlements (
  settlement_reference text PRIMARY KEY,
  lifecycle_id text NOT NULL,
  opportunity_id text NOT NULL,
  strategy text NOT NULL,
  status text NOT NULL CHECK (status IN ('APPLYING','APPLIED','QUARANTINED')),
  cash_delta_usd numeric(78,36) NOT NULL,
  realized_profit_usd numeric(78,36) NOT NULL,
  realized_fees_usd numeric(78,36) NOT NULL CHECK (realized_fees_usd >= 0),
  realized_incentive_usd numeric(78,36) NOT NULL DEFAULT 0,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  consumed_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polymarket_cash_inventory
  ON public.cryptocrawler_polymarket_system_owned_cash_lots(status, updated_at)
  WHERE remaining_usd > 0;
CREATE INDEX IF NOT EXISTS idx_polymarket_cash_reservations_active
  ON public.cryptocrawler_polymarket_cash_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_polymarket_cash_settlements_opportunity
  ON public.cryptocrawler_polymarket_cash_settlements(opportunity_id, applied_at);

ALTER TABLE public.cryptocrawler_polymarket_system_owned_cash_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_polymarket_cash_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_polymarket_cash_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_polymarket_system_owned_cash_lots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_polymarket_cash_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_polymarket_cash_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_polymarket_system_owned_cash_lots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_polymarket_cash_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_polymarket_cash_settlements TO service_role;

CREATE OR REPLACE FUNCTION private.cryptocrawler_seed_polymarket_system_owned_cash_lot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exact_amount numeric(78,36);
BEGIN
  IF NEW.destination_kind <> 'other_strategy'
     OR lower(COALESCE(NEW.destination_venue,'')) <> 'polymarket'
     OR NEW.status <> 'PLACED' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'PLACED' THEN RETURN NEW; END IF;
  IF upper(COALESCE(NEW.destination_asset,'')) NOT IN ('USDC','USDC.E') THEN
    RAISE EXCEPTION 'Polymarket system-owned cash allocation must settle in USDC collateral';
  END IF;
  IF lower(COALESCE(NEW.destination_chain,'')) NOT IN ('polygon','matic') THEN
    RAISE EXCEPTION 'Polymarket system-owned cash allocation must settle on Polygon';
  END IF;
  IF NEW.delivered_amount_base_units IS NULL OR NEW.destination_asset_decimals IS NULL THEN
    RAISE EXCEPTION 'PLACED Polymarket allocation requires exact delivered base units and decimals';
  END IF;
  IF COALESCE((NEW.placement_evidence->>'polymarketCollateralAccountSpendableAuthority')::boolean,false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PLACED Polymarket allocation lacks authenticated collateral-account spendability evidence';
  END IF;

  exact_amount := NEW.delivered_amount_base_units::numeric / power(10::numeric, NEW.destination_asset_decimals);
  IF exact_amount <= 0 THEN RAISE EXCEPTION 'PLACED Polymarket allocation delivered amount must be positive'; END IF;

  INSERT INTO public.cryptocrawler_polymarket_system_owned_cash_lots (
    idempotency_key,amount_usd,remaining_usd,status,origin_kind,origin_reference,parent_allocation_id,
    opportunity_id,strategy,settlement_reference,settlement_evidence,authority_evidence
  ) VALUES (
    'polymarket-system-deposit:' || NEW.allocation_id,
    exact_amount,exact_amount,'ACTIVE','SYSTEM_TRANSFER',NEW.allocation_id,NEW.allocation_id,
    NEW.opportunity_id,NEW.strategy,COALESCE(NULLIF(NEW.placement_reference,''),NEW.allocation_id),
    COALESCE(NEW.placement_evidence,'{}'::jsonb),
    COALESCE(NEW.authority_evidence,'{}'::jsonb) || jsonb_build_object(
      'accountBalanceMintsOwnership',false,
      'polymarketAllocationPlacementProven',true
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cryptocrawler_seed_polymarket_system_owned_cash_lot_trigger
  ON public.cryptocrawler_system_capital_allocations;
CREATE TRIGGER cryptocrawler_seed_polymarket_system_owned_cash_lot_trigger
AFTER INSERT OR UPDATE OF status, delivered_amount_base_units, placement_evidence
ON public.cryptocrawler_system_capital_allocations
FOR EACH ROW
EXECUTE FUNCTION private.cryptocrawler_seed_polymarket_system_owned_cash_lot();

INSERT INTO public.cryptocrawler_polymarket_system_owned_cash_lots (
  idempotency_key,amount_usd,remaining_usd,status,origin_kind,origin_reference,parent_allocation_id,
  opportunity_id,strategy,settlement_reference,settlement_evidence,authority_evidence
)
SELECT
  'polymarket-system-deposit:' || allocation_id,
  delivered_amount_base_units::numeric / power(10::numeric,destination_asset_decimals),
  delivered_amount_base_units::numeric / power(10::numeric,destination_asset_decimals),
  'ACTIVE','SYSTEM_TRANSFER',allocation_id,allocation_id,opportunity_id,strategy,
  COALESCE(NULLIF(placement_reference,''),allocation_id),
  COALESCE(placement_evidence,'{}'::jsonb),
  COALESCE(authority_evidence,'{}'::jsonb) || jsonb_build_object(
    'accountBalanceMintsOwnership',false,
    'polymarketAllocationPlacementProven',true
  )
FROM public.cryptocrawler_system_capital_allocations
WHERE destination_kind='other_strategy'
  AND lower(COALESCE(destination_venue,''))='polymarket'
  AND status='PLACED'
  AND upper(COALESCE(destination_asset,'')) IN ('USDC','USDC.E')
  AND lower(COALESCE(destination_chain,'')) IN ('polygon','matic')
  AND delivered_amount_base_units IS NOT NULL
  AND COALESCE((placement_evidence->>'polymarketCollateralAccountSpendableAuthority')::boolean,false)=true
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cryptocrawler_reserve_polymarket_system_cash(
  p_lifecycle_id text,
  p_opportunity_id text,
  p_amount_usd numeric,
  p_expires_at timestamptz,
  p_authority_evidence jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owned_available numeric(78,36);
  existing_id uuid;
  result_id uuid;
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd <= 0 THEN RAISE EXCEPTION 'Polymarket cash reservation amount must be positive'; END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN RAISE EXCEPTION 'Polymarket cash reservation expiry must be future'; END IF;

  SELECT reservation_id INTO existing_id
  FROM public.cryptocrawler_polymarket_cash_reservations
  WHERE lifecycle_id=p_lifecycle_id AND opportunity_id=p_opportunity_id
    AND status='HELD' AND expires_at > now()
  FOR UPDATE;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  PERFORM 1 FROM public.cryptocrawler_polymarket_system_owned_cash_lots
  WHERE status='ACTIVE' AND remaining_usd > 0 ORDER BY created_at,lot_id FOR UPDATE;

  SELECT
    COALESCE((SELECT SUM(remaining_usd) FROM public.cryptocrawler_polymarket_system_owned_cash_lots WHERE status='ACTIVE' AND remaining_usd > 0),0)
    - COALESCE((SELECT SUM(amount_usd) FROM public.cryptocrawler_polymarket_cash_reservations WHERE status='HELD' AND expires_at > now()),0)
  INTO owned_available;
  IF owned_available < p_amount_usd THEN RETURN NULL; END IF;

  INSERT INTO public.cryptocrawler_polymarket_cash_reservations
    (lifecycle_id,opportunity_id,amount_usd,status,expires_at,authority_evidence)
  VALUES (p_lifecycle_id,p_opportunity_id,p_amount_usd,'HELD',p_expires_at,COALESCE(p_authority_evidence,'{}'::jsonb))
  ON CONFLICT (lifecycle_id,opportunity_id) DO UPDATE
  SET amount_usd=EXCLUDED.amount_usd,status='HELD',expires_at=EXCLUDED.expires_at,
      authority_evidence=EXCLUDED.authority_evidence,updated_at=now()
  WHERE public.cryptocrawler_polymarket_cash_reservations.status <> 'HELD'
     OR public.cryptocrawler_polymarket_cash_reservations.expires_at <= now()
  RETURNING reservation_id INTO result_id;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_release_polymarket_system_cash(p_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.cryptocrawler_polymarket_cash_reservations SET status='RELEASED',updated_at=now()
  WHERE reservation_id=p_reservation_id AND status='HELD';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_renew_polymarket_system_cash(p_reservation_id uuid,p_expires_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE changed integer;
BEGIN
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN RETURN false; END IF;
  UPDATE public.cryptocrawler_polymarket_cash_reservations
  SET expires_at=GREATEST(expires_at,p_expires_at),updated_at=now()
  WHERE reservation_id=p_reservation_id AND status='HELD' AND expires_at > now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed=1;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_polymarket_system_cash(text,text,numeric,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_release_polymarket_system_cash(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_renew_polymarket_system_cash(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_polymarket_system_cash(text,text,numeric,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_polymarket_system_cash(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_renew_polymarket_system_cash(uuid,timestamptz) TO service_role;

COMMENT ON TABLE public.cryptocrawler_polymarket_system_owned_cash_lots IS
  'Exact system-owned Polymarket collateral. Authenticated account balances are capacity ceilings only and never mint ownership.';
COMMENT ON TABLE public.cryptocrawler_polymarket_cash_reservations IS
  'Durable holds against proven system-owned Polymarket collateral for prediction-market lifecycles.';
COMMENT ON TABLE public.cryptocrawler_polymarket_cash_settlements IS
  'Idempotent Polymarket terminal cash P/L boundary; only authenticated terminal net P/L may alter ownership.';
