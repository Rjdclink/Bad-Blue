-- Coinbase Advanced Trade can participate in system-owned execution only after
-- authenticated terminal order/fill evidence proves exact asset deltas. This
-- migration widens the canonical ownership tables; it does not create ownership
-- from account balances and does not enable Coinbase deposit placement.

ALTER TABLE public.cryptocrawler_cex_system_owned_lots
  DROP CONSTRAINT IF EXISTS cryptocrawler_cex_system_owned_lots_venue_check;
ALTER TABLE public.cryptocrawler_cex_system_owned_lots
  ADD CONSTRAINT cryptocrawler_cex_system_owned_lots_venue_check
  CHECK (venue IN ('coinbase','kraken','okx'));

ALTER TABLE public.cryptocrawler_cex_system_owned_settlements
  DROP CONSTRAINT IF EXISTS cryptocrawler_cex_system_owned_settlements_venue_check;
ALTER TABLE public.cryptocrawler_cex_system_owned_settlements
  ADD CONSTRAINT cryptocrawler_cex_system_owned_settlements_venue_check
  CHECK (venue IN ('coinbase','kraken','okx'));

COMMENT ON TABLE public.cryptocrawler_cex_system_owned_lots IS
  'Exact decimal ownership lots for system-generated CEX capital on Coinbase, Kraken, and OKX. Authenticated account balances never create rows; only settlement-confirmed system deposits/trades/rebates/funding outcomes may create ownership.';
COMMENT ON TABLE public.cryptocrawler_cex_system_owned_settlements IS
  'Idempotency boundary for exact Coinbase/Kraken/OKX ownership transformations. A terminal order may consume/create system-owned lots at most once.';
