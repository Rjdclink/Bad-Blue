-- Lifecycle guard for treasury and threshold-sweep inventory reservations.
-- These reservations protect provenance-backed capital while money movement or
-- settlement is unresolved. They must never become spendable merely because a
-- wall-clock TTL elapsed; only explicit release/terminal confirmation may remove
-- them.

CREATE OR REPLACE FUNCTION public.cryptocrawler_enforce_lifecycle_inventory_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reservation_id LIKE 'treasury:%'
     OR NEW.opportunity_id LIKE 'system-sweep:%' THEN
    NEW.expires_at := 'infinity'::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_lifecycle_inventory_reservation
  ON public.cryptocrawler_cex_inventory_reservations_v1;
CREATE TRIGGER trg_cryptocrawler_lifecycle_inventory_reservation
BEFORE INSERT OR UPDATE OF reservation_id, opportunity_id, expires_at
ON public.cryptocrawler_cex_inventory_reservations_v1
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_enforce_lifecycle_inventory_reservation();

-- Repair any reservation created by an earlier process before this guard was
-- installed. Explicit release/confirmation functions still delete these rows.
UPDATE public.cryptocrawler_cex_inventory_reservations_v1
SET expires_at='infinity'::timestamptz
WHERE reservation_id LIKE 'treasury:%'
   OR opportunity_id LIKE 'system-sweep:%';

REVOKE ALL ON FUNCTION public.cryptocrawler_enforce_lifecycle_inventory_reservation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_enforce_lifecycle_inventory_reservation() TO service_role;

COMMENT ON FUNCTION public.cryptocrawler_enforce_lifecycle_inventory_reservation() IS
  'Forces treasury-transfer and system-sweep inventory holds to remain active until explicit release or terminal confirmation; elapsed TTL can never reopen unresolved capital to live trading.';
