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

CREATE INDEX IF NOT EXISTS idx_cex_system_owned_lots_inventory
  ON public.cryptocrawler_cex_system_owned_lots(venue, asset, status, updated_at)
  WHERE remaining_decimal > 0;

CREATE INDEX IF NOT EXISTS idx_cex_system_owned_lots_origin
  ON public.cryptocrawler_cex_system_owned_lots(origin_kind, origin_reference);

CREATE INDEX IF NOT EXISTS idx_cex_system_owned_lots_opportunity
  ON public.cryptocrawler_cex_system_owned_lots(opportunity_id, strategy, created_at);

ALTER TABLE public.cryptocrawler_cex_system_owned_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_cex_system_owned_lots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_system_owned_lots TO service_role;

COMMENT ON TABLE public.cryptocrawler_cex_system_owned_lots IS
  'Exact decimal ownership lots for system-generated CEX capital. Authenticated account balances never create rows; only settlement-confirmed system deposits/trades/rebates/funding outcomes may create ownership.';
