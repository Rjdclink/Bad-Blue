-- Durable, quote-independent inventory transformation for SELF_FUNDED CEX bootstrap.
-- A submitted single-leg inventory acquisition is never allowed to become
-- spendable again merely because its original arbitrage quote expired or a
-- process restarted. The canonical CEX inventory reservation remains the spend
-- lock until exact authenticated terminal fill evidence is applied.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cex_inventory_transforms (
  transform_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  demand_id uuid NOT NULL REFERENCES public.cryptocrawler_cex_bootstrap_demands(demand_id) ON DELETE RESTRICT,
  opportunity_id text NOT NULL,
  venue text NOT NULL CHECK (venue IN ('coinbase','kraken','okx')),
  symbol text NOT NULL,
  base_asset text NOT NULL,
  quote_asset text NOT NULL,
  required_total_base_decimal numeric(78,36) NOT NULL CHECK (required_total_base_decimal > 0),
  requested_base_decimal numeric(78,36) NOT NULL CHECK (requested_base_decimal > 0),
  limit_price_decimal numeric(78,36) NOT NULL CHECK (limit_price_decimal > 0),
  reserved_quote_decimal numeric(78,36) NOT NULL CHECK (reserved_quote_decimal > 0),
  inventory_reservation_id text NOT NULL,
  order_id text,
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN (
    'PREPARED','SUBMITTED','SETTLING','APPLIED','NO_FILL','MANUAL_REVIEW'
  )),
  authority_evidence jsonb NOT NULL,
  settlement_reference text,
  settlement_evidence jsonb,
  last_error text,
  submitted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cex_inventory_transform_order
  ON public.cryptocrawler_cex_inventory_transforms(venue, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cex_inventory_transform_pending
  ON public.cryptocrawler_cex_inventory_transforms(status, updated_at)
  WHERE status IN ('PREPARED','SUBMITTED','SETTLING','MANUAL_REVIEW');
CREATE INDEX IF NOT EXISTS idx_cex_inventory_transform_demand
  ON public.cryptocrawler_cex_inventory_transforms(demand_id, created_at DESC);

ALTER TABLE public.cryptocrawler_cex_inventory_transforms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_cex_inventory_transforms FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_inventory_transforms TO service_role;

COMMENT ON TABLE public.cryptocrawler_cex_inventory_transforms IS
  'Durable single-leg CEX inventory acquisitions. Spend authority remains locked by the canonical inventory reservation until authenticated exact terminal fill deltas are applied to system-owned lots.';