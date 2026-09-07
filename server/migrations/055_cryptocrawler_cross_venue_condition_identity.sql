-- Repair and enforce exact Polymarket condition identity on durable cross-venue
-- event lifecycles. Discovery persists secondVenueConditionId in the immutable
-- plan; lifecycle storage may never replace, infer, or zero-fill that identity.

CREATE OR REPLACE FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  planned text;
BEGIN
  planned := lower(trim(COALESCE(NEW.plan->>'secondVenueConditionId','')));
  IF planned !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'cross-venue event plan has no valid secondVenueConditionId';
  END IF;
  IF NEW.polymarket_condition_id IS NOT NULL
     AND lower(trim(NEW.polymarket_condition_id)) <> planned
     AND lower(trim(NEW.polymarket_condition_id)) <> ('0x' || repeat('0',64)) THEN
    RAISE EXCEPTION 'cross-venue event condition identity mismatch';
  END IF;
  NEW.polymarket_condition_id := planned;
  RETURN NEW;
END;
$$;

-- Existing rows created during the narrow pre-enforcement window are repaired
-- only from the already persisted immutable plan. Invalid rows remain untouched
-- and will fail closed at lifecycle admission/recovery.
UPDATE private.cryptocrawler_cross_venue_event_lifecycles
SET polymarket_condition_id=lower(trim(plan->>'secondVenueConditionId')),
    updated_at=now()
WHERE COALESCE(plan->>'secondVenueConditionId','') ~* '^0x[0-9a-f]{64}$'
  AND lower(polymarket_condition_id) <> lower(trim(plan->>'secondVenueConditionId'));

DROP TRIGGER IF EXISTS cryptocrawler_bind_cross_venue_condition_identity_trigger
  ON private.cryptocrawler_cross_venue_event_lifecycles;
CREATE TRIGGER cryptocrawler_bind_cross_venue_condition_identity_trigger
BEFORE INSERT OR UPDATE OF polymarket_condition_id, plan
ON private.cryptocrawler_cross_venue_event_lifecycles
FOR EACH ROW EXECUTE FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity();

REVOKE ALL ON FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity() TO service_role;

COMMENT ON FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity() IS
  'Makes the reviewed immutable plan secondVenueConditionId the sole durable Polymarket condition identity for cross-venue event execution; rejects conflicting identities and prevents zero-filled fallback from becoming authority.';
