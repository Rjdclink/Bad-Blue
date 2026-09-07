-- Durable Kalshi <-> Polymarket cross-venue prediction-event lifecycle.
-- This table is recovery/state authority only. Discovery cannot submit orders;
-- canonical dispatch/lifecycle must independently re-prove semantics, executable
-- economics, system-owned cash on both venues, and FOK leg state.

CREATE TABLE IF NOT EXISTS private.cryptocrawler_cross_venue_event_lifecycles (
  lifecycle_id text PRIMARY KEY,
  opportunity_id text NOT NULL UNIQUE,
  kalshi_ticker text NOT NULL,
  polymarket_market_id text NOT NULL,
  polymarket_condition_id text NOT NULL CHECK (
    polymarket_condition_id ~ '^0x[0-9a-fA-F]{64}$'
    AND lower(polymarket_condition_id) <> ('0x' || repeat('0', 64))
  ),
  matched_contracts integer NOT NULL CHECK (matched_contracts > 0),
  kalshi_outcome text NOT NULL CHECK (kalshi_outcome IN ('yes','no')),
  polymarket_outcome text NOT NULL CHECK (polymarket_outcome IN ('yes','no')),
  status text NOT NULL CHECK (status IN (
    'RESERVING','KALSHI_OPENING','KALSHI_FILLED','POLYMARKET_OPENING',
    'HEDGED_WAITING_SETTLEMENT','ONE_LEG_RECOVERY','KALSHI_UNWINDING',
    'FLAT_RECOVERED','SETTLED','FAILED','QUARANTINED'
  )),
  plan jsonb NOT NULL,
  semantic_fingerprint text NOT NULL,
  kalshi_cash_reservation_id uuid REFERENCES public.cryptocrawler_kalshi_event_cash_reservations(reservation_id),
  polymarket_cash_reservation_id uuid REFERENCES public.cryptocrawler_polymarket_cash_reservations(reservation_id),
  kalshi_order_id text,
  polymarket_order_id text CHECK (polymarket_order_id IS NULL OR polymarket_order_id ~ '^0x[0-9a-fA-F]{64}$'),
  kalshi_unwind_order_id text,
  kalshi_entry_receipt jsonb,
  polymarket_entry_receipt jsonb,
  recovery_receipt jsonb,
  terminal_settlement jsonb,
  last_error text,
  submitted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cross_venue_event_lifecycle_recovery
  ON private.cryptocrawler_cross_venue_event_lifecycles(status, updated_at)
  WHERE status NOT IN ('FLAT_RECOVERED','SETTLED','FAILED');

CREATE INDEX IF NOT EXISTS idx_cross_venue_event_lifecycle_market
  ON private.cryptocrawler_cross_venue_event_lifecycles(kalshi_ticker, polymarket_condition_id, status);

ALTER TABLE private.cryptocrawler_cross_venue_event_lifecycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_cross_venue_event_lifecycles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_cross_venue_event_lifecycles TO service_role;

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
  IF planned !~ '^0x[0-9a-f]{64}$'
     OR planned = ('0x' || repeat('0',64)) THEN
    RAISE EXCEPTION 'cross-venue event plan has no valid non-zero secondVenueConditionId';
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

DROP TRIGGER IF EXISTS cryptocrawler_bind_cross_venue_condition_identity_trigger
  ON private.cryptocrawler_cross_venue_event_lifecycles;
CREATE TRIGGER cryptocrawler_bind_cross_venue_condition_identity_trigger
BEFORE INSERT OR UPDATE OF polymarket_condition_id, plan
ON private.cryptocrawler_cross_venue_event_lifecycles
FOR EACH ROW EXECUTE FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity();

REVOKE ALL ON FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity() TO service_role;

COMMENT ON TABLE private.cryptocrawler_cross_venue_event_lifecycles IS
  'Durable cross-venue prediction-event state. Kalshi is sequenced first because its authenticated reduce-only FOK unwind is the defined one-leg recovery path; Polymarket is never submitted while Kalshi entry state is ambiguous. Exact non-zero Polymarket condition identity is bound to the immutable plan.';

COMMENT ON FUNCTION private.cryptocrawler_bind_cross_venue_condition_identity() IS
  'Makes the reviewed immutable plan secondVenueConditionId the sole durable Polymarket condition identity for cross-venue event execution; rejects conflicts and zero-filled authority.';
