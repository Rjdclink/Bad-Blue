-- CryptoCrawler inventory state is private execution infrastructure. Define the
-- durable schema here so fresh environments do not rely on runtime table creation
-- inheriting browser-facing default grants. Runtime CREATE IF NOT EXISTS remains
-- compatibility-only after this migration.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cex_inventory_state_v1 (
  venue text NOT NULL,
  asset text NOT NULL,
  available numeric NOT NULL,
  payout_reserved numeric NOT NULL DEFAULT 0,
  pending_order numeric NOT NULL DEFAULT 0,
  pending_transfer numeric NOT NULL DEFAULT 0,
  target numeric NULL,
  minimum_reserve numeric NOT NULL DEFAULT 0,
  maximum_venue_exposure numeric NULL,
  reconciled_at timestamptz NOT NULL,
  PRIMARY KEY (venue, asset)
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cex_inventory_reservations_v1 (
  reservation_id text NOT NULL,
  opportunity_id text NOT NULL,
  venue text NOT NULL,
  asset text NOT NULL,
  amount numeric NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (reservation_id, venue, asset)
);

CREATE INDEX IF NOT EXISTS cryptocrawler_cex_inventory_reservations_v1_active_idx
  ON public.cryptocrawler_cex_inventory_reservations_v1 (venue, asset, expires_at);

ALTER TABLE public.cryptocrawler_cex_inventory_state_v1
  ADD COLUMN IF NOT EXISTS payout_reserved numeric NOT NULL DEFAULT 0;

ALTER TABLE public.cryptocrawler_cex_inventory_state_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_cex_inventory_reservations_v1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cryptocrawler_cex_inventory_state_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_cex_inventory_reservations_v1 FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_inventory_state_v1 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_inventory_reservations_v1 TO service_role;

COMMENT ON TABLE public.cryptocrawler_cex_inventory_state_v1 IS
  'Private authenticated CEX inventory state. Browser-facing roles are intentionally denied; server owner/service-role treasury logic only.';
COMMENT ON TABLE public.cryptocrawler_cex_inventory_reservations_v1 IS
  'Private live-trade inventory reservations. Browser-facing roles are intentionally denied; server owner/service-role treasury logic only.';