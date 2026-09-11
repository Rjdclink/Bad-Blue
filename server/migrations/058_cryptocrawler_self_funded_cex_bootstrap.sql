-- Durable bridge between terminal SELF_FUNDED on-chain ownership and CEX ownership.
-- A CEX deposit may take far longer than an arbitrage quote remains executable, so
-- quote lifetime and capital-placement lifetime are intentionally separate. The
-- on-chain reservation remains the source-ownership lock until the destination
-- exchange proves terminal spendability.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cex_bootstrap_demands (
  demand_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  opportunity_id text NOT NULL,
  symbol text NOT NULL,
  inventory_role text NOT NULL CHECK (inventory_role IN ('BUY_QUOTE','SELL_BASE')),
  destination_venue text NOT NULL CHECK (destination_venue IN ('coinbase','kraken','okx')),
  destination_asset text NOT NULL,
  required_amount_decimal numeric(78,36) NOT NULL CHECK (required_amount_decimal > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','RESERVED','PLACEMENT_PENDING','READY','TRANSFORM_REQUIRED','MANUAL_REVIEW'
  )),
  last_error text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cex_bootstrap_bridges (
  bridge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL REFERENCES public.cryptocrawler_cex_bootstrap_demands(demand_id) ON DELETE RESTRICT,
  allocation_id text NOT NULL UNIQUE REFERENCES public.cryptocrawler_system_capital_allocations(allocation_id) ON DELETE RESTRICT,
  onchain_reservation_id uuid NOT NULL UNIQUE REFERENCES public.cryptocrawler_onchain_inventory_reservations(reservation_id) ON DELETE RESTRICT,
  source_chain text NOT NULL,
  source_asset text NOT NULL,
  source_token_address text NOT NULL,
  source_amount_base_units numeric(78,0) NOT NULL CHECK (source_amount_base_units > 0),
  destination_venue text NOT NULL CHECK (destination_venue IN ('coinbase','kraken','okx')),
  destination_asset text NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN (
    'RESERVED','PLACEMENT_PENDING','APPLIED','RELEASED','MANUAL_REVIEW'
  )),
  consumed_onchain_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cex_bootstrap_demands_pending
  ON public.cryptocrawler_cex_bootstrap_demands(status, updated_at)
  WHERE status IN ('PENDING','RESERVED','PLACEMENT_PENDING','TRANSFORM_REQUIRED','MANUAL_REVIEW');
CREATE INDEX IF NOT EXISTS idx_cex_bootstrap_bridges_pending
  ON public.cryptocrawler_cex_bootstrap_bridges(status, updated_at)
  WHERE status IN ('RESERVED','PLACEMENT_PENDING','MANUAL_REVIEW');
CREATE INDEX IF NOT EXISTS idx_cex_bootstrap_bridges_demand
  ON public.cryptocrawler_cex_bootstrap_bridges(demand_id, created_at DESC);

ALTER TABLE public.cryptocrawler_cex_bootstrap_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_cex_bootstrap_bridges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_cex_bootstrap_demands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_cex_bootstrap_bridges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_bootstrap_demands TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_bootstrap_bridges TO service_role;

-- Consumes the reserved on-chain source only when the allocation has already
-- reached PLACED. The migration-055 CEX ownership trigger runs in the same UPDATE
-- transaction, so source consumption and destination lot creation succeed or roll
-- back together. Generic wallet balance is never ownership authority.
CREATE OR REPLACE FUNCTION private.cryptocrawler_apply_cex_bootstrap_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bridge_row public.cryptocrawler_cex_bootstrap_bridges%ROWTYPE;
  reservation_row public.cryptocrawler_onchain_inventory_reservations%ROWTYPE;
  lot_row record;
  remaining numeric(78,0);
  take_amount numeric(78,0);
  consumed jsonb := '[]'::jsonb;
  system_gas_authority boolean;
  system_gas_settled boolean;
BEGIN
  IF NEW.destination_kind <> 'cex' OR NEW.status <> 'PLACED' OR OLD.status = 'PLACED' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO bridge_row
  FROM public.cryptocrawler_cex_bootstrap_bridges
  WHERE allocation_id=NEW.allocation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF bridge_row.status='APPLIED' THEN
    RETURN NEW;
  END IF;

  system_gas_authority := COALESCE((NEW.placement_evidence->>'systemNativeGasAuthority')::boolean, false);
  system_gas_settled := COALESCE((NEW.placement_evidence->>'systemNativeGasSettled')::boolean, false);
  IF system_gas_authority IS DISTINCT FROM true OR system_gas_settled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CEX bootstrap allocation % cannot become owned without settled provenance-backed native gas', NEW.allocation_id;
  END IF;
  IF COALESCE((NEW.placement_evidence->>'rawWalletNativeBalanceAuthority')::boolean, false)=true THEN
    RAISE EXCEPTION 'CEX bootstrap allocation % attempted to use raw wallet native balance as spend authority', NEW.allocation_id;
  END IF;

  SELECT * INTO reservation_row
  FROM public.cryptocrawler_onchain_inventory_reservations
  WHERE reservation_id=bridge_row.onchain_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CEX bootstrap source reservation % is missing', bridge_row.onchain_reservation_id;
  END IF;

  IF lower(reservation_row.chain) <> lower(bridge_row.source_chain)
     OR lower(reservation_row.token_address) <> lower(bridge_row.source_token_address)
     OR reservation_row.amount_base_units <> bridge_row.source_amount_base_units THEN
    RAISE EXCEPTION 'CEX bootstrap source reservation identity mismatch for allocation %', NEW.allocation_id;
  END IF;
  IF lower(COALESCE(NEW.source_chain,'')) <> lower(bridge_row.source_chain)
     OR lower(COALESCE(NEW.source_token_address,'')) <> lower(bridge_row.source_token_address)
     OR NEW.source_amount_base_units::numeric <> bridge_row.source_amount_base_units THEN
    RAISE EXCEPTION 'CEX bootstrap allocation/source identity mismatch for allocation %', NEW.allocation_id;
  END IF;
  IF lower(COALESCE(NEW.destination_venue,'')) <> lower(bridge_row.destination_venue)
     OR upper(COALESCE(NEW.destination_asset,'')) <> upper(bridge_row.destination_asset) THEN
    RAISE EXCEPTION 'CEX bootstrap destination identity mismatch for allocation %', NEW.allocation_id;
  END IF;

  remaining := bridge_row.source_amount_base_units;
  FOR lot_row IN
    SELECT lot_id, remaining_base_units
    FROM public.cryptocrawler_onchain_system_owned_lots
    WHERE lower(chain)=lower(bridge_row.source_chain)
      AND lower(token_address)=lower(bridge_row.source_token_address)
      AND status='ACTIVE' AND remaining_base_units > 0
    ORDER BY created_at ASC, lot_id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    take_amount := LEAST(remaining, lot_row.remaining_base_units);
    UPDATE public.cryptocrawler_onchain_system_owned_lots
    SET remaining_base_units=remaining_base_units-take_amount,
        status=CASE WHEN remaining_base_units-take_amount=0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
        updated_at=now()
    WHERE lot_id=lot_row.lot_id;
    consumed := consumed || jsonb_build_array(lot_row.lot_id::text);
    remaining := remaining-take_amount;
  END LOOP;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'CEX bootstrap source ownership deficit for allocation %, missing base units %', NEW.allocation_id, remaining;
  END IF;

  DELETE FROM public.cryptocrawler_onchain_inventory_reservations
  WHERE reservation_id=bridge_row.onchain_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CEX bootstrap source reservation disappeared during settlement for allocation %', NEW.allocation_id;
  END IF;

  UPDATE public.cryptocrawler_cex_bootstrap_bridges
  SET status='APPLIED', consumed_onchain_lot_ids=consumed, applied_at=now(), updated_at=now()
  WHERE bridge_id=bridge_row.bridge_id;

  UPDATE public.cryptocrawler_cex_bootstrap_demands
  SET status='READY', last_error=NULL, updated_at=now()
  WHERE demand_id=bridge_row.demand_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cryptocrawler_apply_cex_bootstrap_source_trigger
  ON public.cryptocrawler_system_capital_allocations;
CREATE TRIGGER cryptocrawler_apply_cex_bootstrap_source_trigger
AFTER UPDATE OF status, delivered_amount_base_units, placement_evidence
ON public.cryptocrawler_system_capital_allocations
FOR EACH ROW
EXECUTE FUNCTION private.cryptocrawler_apply_cex_bootstrap_source();

COMMENT ON TABLE public.cryptocrawler_cex_bootstrap_demands IS
  'Durable, quote-independent inventory demand created after canonical positive economics and governance/notional admission. A demand is not executable inventory.';
COMMENT ON TABLE public.cryptocrawler_cex_bootstrap_bridges IS
  'Exactly-once ownership bridge from a reserved SELF_FUNDED on-chain lot to a terminally spendable CEX allocation. Source ownership remains reserved until destination placement and system-owned gas settlement are proven.';
