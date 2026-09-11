-- Durable bridge between terminal SELF_FUNDED on-chain ownership and CEX ownership.
-- A CEX deposit may take far longer than an arbitrage quote remains executable, so
-- quote lifetime and capital-placement lifetime are intentionally separate. The
-- on-chain reservation remains the source-ownership lock until the destination
-- exchange proves terminal spendability.

-- reservation_id is generated as a UUID and is used by runtime code as a global
-- reservation identity. Migration 042 made the primary key composite, so expose
-- the intended single-column uniqueness before using reservation_id as an FK.
CREATE UNIQUE INDEX IF NOT EXISTS cryptocrawler_onchain_inventory_reservation_id_uidx
  ON public.cryptocrawler_onchain_inventory_reservations(reservation_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_cex_bootstrap_one_active_bridge_per_demand
  ON public.cryptocrawler_cex_bootstrap_bridges(demand_id)
  WHERE status IN ('RESERVED','PLACEMENT_PENDING','MANUAL_REVIEW');

ALTER TABLE public.cryptocrawler_cex_bootstrap_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_cex_bootstrap_bridges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_cex_bootstrap_demands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_cex_bootstrap_bridges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_bootstrap_demands TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_bootstrap_bridges TO service_role;

-- Re-entry while a placement is still active may acquire a fresh aggregate
-- reservation before the durable bridge is observed. Collapse that replay at
-- the database boundary and release only the redundant reservation. A different
-- active allocation for the same demand is a contradiction and fails closed.
CREATE OR REPLACE FUNCTION private.cryptocrawler_dedupe_cex_bootstrap_bridge()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_bridge public.cryptocrawler_cex_bootstrap_bridges%ROWTYPE;
BEGIN
  SELECT * INTO existing_bridge
  FROM public.cryptocrawler_cex_bootstrap_bridges
  WHERE demand_id=NEW.demand_id
    AND status IN ('RESERVED','PLACEMENT_PENDING','MANUAL_REVIEW')
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF existing_bridge.allocation_id <> NEW.allocation_id THEN
      RAISE EXCEPTION 'Active CEX bootstrap demand % is already bound to allocation %', NEW.demand_id, existing_bridge.allocation_id;
    END IF;
    IF existing_bridge.onchain_reservation_id <> NEW.onchain_reservation_id THEN
      DELETE FROM public.cryptocrawler_onchain_inventory_reservations
      WHERE reservation_id=NEW.onchain_reservation_id;
    END IF;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cryptocrawler_dedupe_cex_bootstrap_bridge_trigger
  ON public.cryptocrawler_cex_bootstrap_bridges;
CREATE TRIGGER cryptocrawler_dedupe_cex_bootstrap_bridge_trigger
BEFORE INSERT ON public.cryptocrawler_cex_bootstrap_bridges
FOR EACH ROW
EXECUTE FUNCTION private.cryptocrawler_dedupe_cex_bootstrap_bridge();

-- A pre-broadcast release must permit a later clean retry. Preserve the released
-- allocation as audit history while freeing its request idempotency key;
-- allocation_id remains the immutable durable identity.
CREATE OR REPLACE FUNCTION private.cryptocrawler_prepare_cex_bootstrap_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.strategy='verified_cex_arbitrage_bootstrap'
     AND OLD.status='RESERVED' AND NEW.status='RELEASED' THEN
    NEW.terminal_evidence := COALESCE(NEW.terminal_evidence, '{}'::jsonb)
      || jsonb_build_object('releasedBootstrapIdempotencyKey', OLD.idempotency_key);
    NEW.idempotency_key := OLD.idempotency_key || ':released:' || OLD.allocation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cryptocrawler_prepare_cex_bootstrap_release_trigger
  ON public.cryptocrawler_system_capital_allocations;
CREATE TRIGGER cryptocrawler_prepare_cex_bootstrap_release_trigger
BEFORE UPDATE OF status ON public.cryptocrawler_system_capital_allocations
FOR EACH ROW
EXECUTE FUNCTION private.cryptocrawler_prepare_cex_bootstrap_release();

CREATE OR REPLACE FUNCTION private.cryptocrawler_finalize_cex_bootstrap_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  released_reservation uuid;
BEGIN
  IF OLD.strategy='verified_cex_arbitrage_bootstrap'
     AND OLD.status='RESERVED' AND NEW.status='RELEASED' THEN
    SELECT onchain_reservation_id INTO released_reservation
    FROM public.cryptocrawler_cex_bootstrap_bridges
    WHERE allocation_id=NEW.allocation_id
    FOR UPDATE;

    UPDATE public.cryptocrawler_cex_bootstrap_bridges
    SET status='RELEASED', updated_at=now()
    WHERE allocation_id=NEW.allocation_id
      AND status='RESERVED';

    IF released_reservation IS NOT NULL THEN
      DELETE FROM public.cryptocrawler_onchain_inventory_reservations
      WHERE reservation_id=released_reservation;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cryptocrawler_finalize_cex_bootstrap_release_trigger
  ON public.cryptocrawler_system_capital_allocations;
CREATE TRIGGER cryptocrawler_finalize_cex_bootstrap_release_trigger
AFTER UPDATE OF status ON public.cryptocrawler_system_capital_allocations
FOR EACH ROW
EXECUTE FUNCTION private.cryptocrawler_finalize_cex_bootstrap_release();

-- Consumes the reserved on-chain source only when the allocation has already
-- reached PLACED. Migration 055's CEX ownership trigger runs in the same UPDATE
-- transaction, so source consumption and destination lot creation succeed or roll
-- back together. Generic wallet balance is never ownership authority.
CREATE OR REPLACE FUNCTION private.cryptocrawler_apply_cex_bootstrap_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bridge_row public.cryptocrawler_cex_bootstrap_bridges%ROWTYPE;
  reservation_row public.cryptocrawler_onchain_inventory_reservations%ROWTYPE;
  gas_spend record;
  gas_spend_id_text text;
  lot_row record;
  remaining numeric(78,0);
  take_amount numeric(78,0);
  consumed jsonb := '[]'::jsonb;
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

  IF COALESCE((NEW.placement_evidence->>'rawWalletNativeBalanceAuthority')::boolean, false)=true THEN
    RAISE EXCEPTION 'CEX bootstrap allocation % attempted to use raw wallet native balance as spend authority', NEW.allocation_id;
  END IF;
  gas_spend_id_text := NULLIF(trim(COALESCE(NEW.placement_evidence->>'systemNativeGasSpendId','')), '');
  IF gas_spend_id_text IS NULL OR gas_spend_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CEX bootstrap allocation % has no valid provenance-backed gas spend identity', NEW.allocation_id;
  END IF;

  SELECT status, scope, chain, wallet, transaction_hash, actual_spent_wei
  INTO gas_spend
  FROM public.cryptocrawler_system_native_gas_spends
  WHERE spend_id=gas_spend_id_text::uuid
  FOR UPDATE;
  IF NOT FOUND
     OR gas_spend.status <> 'SETTLED'
     OR lower(COALESCE(gas_spend.transaction_hash,'')) <> lower(COALESCE(NEW.placement_reference,''))
     OR lower(COALESCE(gas_spend.chain,'')) <> lower(COALESCE(NEW.source_chain,''))
     OR lower(COALESCE(gas_spend.wallet,'')) <> lower(COALESCE(NEW.source_recipient,''))
     OR COALESCE(gas_spend.actual_spent_wei, -1) < 0 THEN
    RAISE EXCEPTION 'CEX bootstrap allocation % lacks terminal canonical native-gas settlement', NEW.allocation_id;
  END IF;
  IF NULLIF(trim(COALESCE(NEW.placement_evidence->>'systemNativeGasScope','')), '') IS DISTINCT FROM gas_spend.scope THEN
    RAISE EXCEPTION 'CEX bootstrap allocation % gas scope does not match canonical spend ledger', NEW.allocation_id;
  END IF;

  SELECT * INTO reservation_row
  FROM public.cryptocrawler_onchain_inventory_reservations
  WHERE reservation_id=bridge_row.onchain_reservation_id
    AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CEX bootstrap source reservation % is missing or expired', bridge_row.onchain_reservation_id;
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
  'Exactly-once ownership bridge from a reserved SELF_FUNDED on-chain lot to a terminally spendable CEX allocation. Released attempts remain auditable while only one active bridge may exist per demand.';
