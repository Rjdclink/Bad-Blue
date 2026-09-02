-- Durable retained/system-capital allocation state.
-- This is accounting/settlement authority only: Cryptara + Profit Ladder +
-- governance remain the strategy/notional/execution authorities.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_system_capital_allocations (
  allocation_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  capital_scope text NOT NULL REFERENCES public.zero_capital_capital_state(scope),
  opportunity_id text,
  strategy text NOT NULL,
  authority_reference text NOT NULL,
  authority_evidence jsonb NOT NULL,
  destination_kind text NOT NULL CHECK (destination_kind IN ('cex','onchain_strategy','native_gas','other_strategy')),
  destination_venue text,
  source_chain text NOT NULL,
  source_asset text NOT NULL,
  source_token_address text,
  source_asset_decimals integer NOT NULL CHECK (source_asset_decimals BETWEEN 0 AND 36),
  source_recipient text NOT NULL,
  source_amount_base_units numeric(78,0) NOT NULL CHECK (source_amount_base_units > 0),
  destination_chain text,
  destination_asset text NOT NULL,
  destination_asset_decimals integer NOT NULL CHECK (destination_asset_decimals BETWEEN 0 AND 36),
  delivered_amount_base_units numeric(78,0) CHECK (delivered_amount_base_units IS NULL OR delivered_amount_base_units > 0),
  remaining_destination_base_units numeric(78,0) CHECK (
    remaining_destination_base_units IS NULL OR
    (remaining_destination_base_units >= 0 AND delivered_amount_base_units IS NOT NULL AND remaining_destination_base_units <= delivered_amount_base_units)
  ),
  status text NOT NULL CHECK (status IN ('RESERVED','PLACEMENT_PENDING','PLACED','CONSUMED','RELEASED','FAILED')),
  placement_reference text,
  placement_evidence jsonb,
  terminal_reference text,
  terminal_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status IN ('RESERVED','PLACEMENT_PENDING','RELEASED','FAILED')) OR
    (status IN ('PLACED','CONSUMED') AND delivered_amount_base_units IS NOT NULL AND remaining_destination_base_units IS NOT NULL)
  )
);

-- Migration 026 may already exist on a preview database. Keep the migration
-- idempotent while tightening old rows to the current source-token contract.
ALTER TABLE public.cryptocrawler_system_capital_allocations
  ADD COLUMN IF NOT EXISTS source_token_address text;

-- Only newly reserved capital may be physically placed. Old reservation rows
-- without an exact token contract remain accounting-only and fail closed.

CREATE INDEX IF NOT EXISTS idx_system_capital_allocations_scope_status
  ON public.cryptocrawler_system_capital_allocations(capital_scope, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_system_capital_allocations_destination
  ON public.cryptocrawler_system_capital_allocations(destination_kind, destination_venue, destination_asset, status);

CREATE INDEX IF NOT EXISTS idx_system_capital_allocations_strategy
  ON public.cryptocrawler_system_capital_allocations(strategy, status, updated_at);

ALTER TABLE public.cryptocrawler_system_capital_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_system_capital_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_system_capital_allocations TO service_role;

COMMENT ON TABLE public.cryptocrawler_system_capital_allocations IS
  'Exact base-unit retained/system-capital reservations and settlement-confirmed placements. Source reservation and delivered destination amounts remain distinct; source token contract and authority evidence are preserved, but this table does not rank strategies or grant execution authority.';
