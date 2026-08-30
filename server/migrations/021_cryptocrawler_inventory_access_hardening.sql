-- CryptoCrawler inventory state is private execution infrastructure. These
-- tables are written by the server-side Postgres owner and read by service-role
-- treasury RPCs; browser-facing anon/authenticated roles have no authority here.

ALTER TABLE IF EXISTS public.cryptocrawler_cex_inventory_state_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cryptocrawler_cex_inventory_reservations_v1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cryptocrawler_cex_inventory_state_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_cex_inventory_reservations_v1 FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_inventory_state_v1 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cex_inventory_reservations_v1 TO service_role;

COMMENT ON TABLE public.cryptocrawler_cex_inventory_state_v1 IS
  'Private authenticated CEX inventory state. Browser-facing roles are intentionally denied; server owner/service-role treasury logic only.';
COMMENT ON TABLE public.cryptocrawler_cex_inventory_reservations_v1 IS
  'Private live-trade inventory reservations. Browser-facing roles are intentionally denied; server owner/service-role treasury logic only.';