-- Provenance-backed on-chain system capital for retained execution use.
-- Generic wallet balances are never ownership authority. Lots are created only
-- from terminal evidence explicitly accepted by the runtime (for example an
-- exact receiver profit transfer), and cross-chain routes reserve/transform only
-- these lots.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_onchain_system_owned_lots (
  lot_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  chain text NOT NULL,
  asset text NOT NULL,
  token_address text NOT NULL,
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  amount_base_units numeric(78,0) NOT NULL CHECK (amount_base_units > 0),
  remaining_base_units numeric(78,0) NOT NULL CHECK (remaining_base_units >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','QUARANTINED')),
  origin_kind text NOT NULL,
  origin_reference text NOT NULL,
  opportunity_id text,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cryptocrawler_onchain_system_owned_active_idx
  ON public.cryptocrawler_onchain_system_owned_lots(chain, token_address, status, created_at);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_onchain_inventory_reservations (
  reservation_id uuid NOT NULL,
  opportunity_id text NOT NULL,
  chain text NOT NULL,
  asset text NOT NULL,
  token_address text NOT NULL,
  amount_base_units numeric(78,0) NOT NULL CHECK (amount_base_units > 0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (reservation_id, chain, token_address)
);

CREATE INDEX IF NOT EXISTS cryptocrawler_onchain_inventory_reservations_active_idx
  ON public.cryptocrawler_onchain_inventory_reservations(chain, token_address, expires_at);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_onchain_system_owned_settlements (
  settlement_reference text PRIMARY KEY,
  opportunity_id text,
  origin_chain text NOT NULL,
  destination_chain text NOT NULL,
  input_asset text NOT NULL,
  output_asset text NOT NULL,
  input_token_address text NOT NULL,
  output_token_address text NOT NULL,
  input_amount_base_units numeric(78,0) NOT NULL CHECK (input_amount_base_units > 0),
  output_amount_base_units numeric(78,0) NOT NULL CHECK (output_amount_base_units >= 0),
  status text NOT NULL CHECK (status IN ('APPLIED','QUARANTINED')),
  consumed_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_lot_id uuid,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

ALTER TABLE public.cryptocrawler_onchain_system_owned_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_onchain_inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_onchain_system_owned_settlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cryptocrawler_onchain_system_owned_lots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_onchain_inventory_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_onchain_system_owned_settlements FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_onchain_system_owned_lots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_onchain_inventory_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_onchain_system_owned_settlements TO service_role;

COMMENT ON TABLE public.cryptocrawler_onchain_system_owned_lots IS
  'Exact token-base-unit CryptoCrawler ownership lots. Wallet balance is never ownership evidence; only terminal provenance creates lots.';
COMMENT ON TABLE public.cryptocrawler_onchain_inventory_reservations IS
  'Exact on-chain system-capital reservations used by canonical execution. Treasury/payout wallet balances have no implicit spend authority.';
COMMENT ON TABLE public.cryptocrawler_onchain_system_owned_settlements IS
  'Idempotent cross-chain ownership transformations from proven origin lots to terminal destination lots.';