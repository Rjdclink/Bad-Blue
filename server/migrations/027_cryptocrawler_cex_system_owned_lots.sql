-- Canonical physical ownership ledger for system-generated capital held on CEXs.
-- The placement/allocation table proves how capital reached a venue. This table
-- proves what exact assets remain system-owned after deposits, fills, fees,
-- rebates and other terminal exchange settlements. Account-wide balances are
-- reconciliation ceilings only and never create ownership.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cex_system_owned_lots (
  lot_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  venue text NOT NULL CHECK (venue IN ('kraken','okx')),
  asset text NOT NULL,
  amount_decimal numeric(78,36) NOT NULL CHECK (amount_decimal > 0),
  remaining_decimal numeric(78,36) NOT NULL CHECK (remaining_decimal >= 0 AND remaining_decimal <= amount_decimal),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','QUARANTINED')),
  origin_kind text NOT NULL CHECK (origin_kind IN (
    'SYSTEM_DEPOSIT',
    'TRADE_FILL',
    'MAKER_REBATE',
    'FUNDING_PAYMENT',
    'FEE_REFUND',
    'OTHER_VERIFIED_SYSTEM_PROFIT'
  )),
  origin_reference text NOT NULL,
  parent_allocation_id text REFERENCES public.cryptocrawler_system_capital_allocations(allocation_id),
  parent_lot_id uuid REFERENCES public.cryptocrawler_cex_system_owned_lots(lot_id),
  opportunity_id text,
  strategy text,
  settlement_reference text NOT NULL,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cex_system_owned_settlements (
  settlement_reference text PRIMARY KEY,
  venue text NOT NULL CHECK (venue IN ('kraken','okx')),
  order_id text NOT NULL,
  opportunity_id text,
  strategy text,
  status text NOT NULL CHECK (status IN ('APPLYING','APPLIED','QUARANTINED')),
  asset_deltas jsonb NOT NULL,
  consumed_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  settlement_evidence jsonb NOT NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue, order_id)
);

CREATE INDEX IF NOT EXISTS idx_cex_system_owned_lots_inventory
  ON public.cryptocrawler_cex_system_owned_lots(venue, asset, status, updated_at)
  WHERE remaining_decimal > 0;

CREATE INDEX IF NOT EXISTS idx_cex_system_owned_lots_origin
  ON public.cryptocrawler_cex_system_owned_lots(origin_kind, origin_reference);

CREATE INDEX IF NOT EXISTS idx_cex_system_owned_lots_opportunity
  ON public.cryptocrawler_cex_system_owned_lots(opportunity_id, strategy, created_at);

CREATE INDEX IF NOT EXISTS idx_cex_system_owned_settlements_opportunity
  ON public.cryptocrawler_cex_system_owned_settlements(opportunity_id, strategy, applied_at);

ALTER TABLE public.cryptocrawler_cex_system_owned_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_cex_system_owned_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_cex_system_owned_lots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_cex_system_owned_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_system_owned_lots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_system_owned_settlements TO service_role;

-- Placement confirmation and physical ownership creation must be atomic. The
-- trigger never reads account-wide exchange balances: it can only mint a lot
-- from a CEX allocation that has already reached PLACED with exact delivered
-- units and settlement evidence. Coinbase remains excluded from system capital.
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
  IF lower(COALESCE(NEW.destination_venue, '')) NOT IN ('kraken','okx') THEN
    RAISE EXCEPTION 'System-owned CEX lot cannot be created for venue %', COALESCE(NEW.destination_venue, 'missing');
  END IF;
  IF NEW.delivered_amount_base_units IS NULL OR NEW.destination_asset_decimals IS NULL THEN
    RAISE EXCEPTION 'PLACED CEX allocation requires exact delivered base units and decimals';
  END IF;

  spendable_authority := COALESCE((NEW.placement_evidence->>'tradingAccountSpendableAuthority')::boolean, false);
  IF lower(NEW.destination_venue) = 'okx' AND spendable_authority IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OKX PLACED allocation lacks Trading-account spendability evidence';
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

DROP TRIGGER IF EXISTS cryptocrawler_seed_cex_system_owned_lot_trigger
  ON public.cryptocrawler_system_capital_allocations;
CREATE TRIGGER cryptocrawler_seed_cex_system_owned_lot_trigger
AFTER UPDATE OF status, delivered_amount_base_units, placement_evidence
ON public.cryptocrawler_system_capital_allocations
FOR EACH ROW
EXECUTE FUNCTION private.cryptocrawler_seed_cex_system_owned_lot();

-- Backfill only already-confirmed placements. This is idempotent and does not
-- infer ownership from balances. Existing OKX rows must carry the same Trading
-- spendability proof required by the trigger.
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
  AND lower(COALESCE(destination_venue,'')) IN ('kraken','okx')
  AND delivered_amount_base_units IS NOT NULL
  AND (
    lower(destination_venue)='kraken'
    OR COALESCE((placement_evidence->>'tradingAccountSpendableAuthority')::boolean, false)=true
  )
ON CONFLICT (idempotency_key) DO NOTHING;

COMMENT ON TABLE public.cryptocrawler_cex_system_owned_lots IS
  'Exact decimal ownership lots for system-generated CEX capital. Authenticated account balances never create rows; only settlement-confirmed system deposits/trades/rebates/funding outcomes may create ownership.';
COMMENT ON TABLE public.cryptocrawler_cex_system_owned_settlements IS
  'Idempotency boundary for exact CEX ownership transformations. A terminal order may consume/create system-owned lots at most once.';
