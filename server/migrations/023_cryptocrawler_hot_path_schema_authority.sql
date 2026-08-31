-- Move execution-critical schema creation out of live trade admission.
-- Runtime code must only verify presence and fail closed when this migration is absent.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.cryptocrawler_resource_leases (
  resource_key text PRIMARY KEY,
  lease_id text NOT NULL,
  owner_id text NOT NULL,
  opportunity_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS cryptocrawler_resource_leases_expires_idx
  ON public.cryptocrawler_resource_leases (expires_at);

-- Preserve the existing slot-by-slot collision semantics while eliminating one
-- client/database round trip per attempted slot. The loop runs inside Postgres;
-- each candidate still uses the same atomic INSERT ... ON CONFLICT takeover rule.
CREATE OR REPLACE FUNCTION private.cryptocrawler_claim_resource_slot(
  p_prefix text,
  p_capacity integer,
  p_start_slot integer,
  p_lease_id text,
  p_owner_id text,
  p_opportunity_id text,
  p_expires_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offset integer;
  v_slot integer;
  v_resource_key text;
  v_claimed_key text;
BEGIN
  IF p_prefix IS NULL OR btrim(p_prefix) = '' THEN
    RAISE EXCEPTION 'resource slot prefix is required';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 300 THEN
    RAISE EXCEPTION 'resource slot capacity out of range: %', p_capacity;
  END IF;

  FOR v_offset IN 0..(p_capacity - 1) LOOP
    v_slot := mod(mod(COALESCE(p_start_slot, 0), p_capacity) + p_capacity + v_offset, p_capacity);
    v_resource_key := p_prefix || ':slot:' || v_slot::text;
    v_claimed_key := NULL;

    INSERT INTO public.cryptocrawler_resource_leases AS leases
      (resource_key, lease_id, owner_id, opportunity_id, expires_at)
    VALUES
      (v_resource_key, p_lease_id, p_owner_id, p_opportunity_id, p_expires_at)
    ON CONFLICT (resource_key) DO UPDATE
    SET lease_id = EXCLUDED.lease_id,
        owner_id = EXCLUDED.owner_id,
        opportunity_id = EXCLUDED.opportunity_id,
        acquired_at = now(),
        expires_at = EXCLUDED.expires_at
    WHERE leases.expires_at <= now()
    RETURNING resource_key INTO v_claimed_key;

    IF v_claimed_key IS NOT NULL THEN
      RETURN v_claimed_key;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.cryptocrawler_mc_calibration_v1 (
  event_id text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  topology text NOT NULL,
  venue_pair text NOT NULL,
  symbol text NOT NULL,
  chain text NOT NULL,
  strategy text NOT NULL,
  size_bucket text NOT NULL,
  payload jsonb NOT NULL,
  model_version text NOT NULL
);

CREATE INDEX IF NOT EXISTS cryptocrawler_mc_calibration_v1_segment_idx
  ON public.cryptocrawler_mc_calibration_v1
    (topology, venue_pair, symbol, chain, strategy, size_bucket, observed_at DESC);

CREATE TABLE IF NOT EXISTS private.cryptocrawler_kraken_nonce_state (
  key_hash text PRIMARY KEY,
  last_nonce bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- These are server-side execution/learning internals. Browser roles have no direct authority.
ALTER TABLE public.cryptocrawler_resource_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_mc_calibration_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.cryptocrawler_kraken_nonce_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cryptocrawler_resource_leases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_mc_calibration_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.cryptocrawler_kraken_nonce_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cryptocrawler_claim_resource_slot(text, integer, integer, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_resource_leases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_mc_calibration_v1 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_kraken_nonce_state TO service_role;
GRANT EXECUTE ON FUNCTION private.cryptocrawler_claim_resource_slot(text, integer, integer, text, text, text, timestamptz) TO service_role;

COMMENT ON TABLE public.cryptocrawler_resource_leases IS
  'Distributed CryptoCrawler execution resource leases. Schema is migration-owned so live trade admission performs no DDL.';
COMMENT ON FUNCTION private.cryptocrawler_claim_resource_slot(text, integer, integer, text, text, text, timestamptz) IS
  'Atomically scans one resource-slot domain server-side and returns the first claimable slot, eliminating repeated client round trips without weakening lease collision semantics.';
COMMENT ON TABLE public.cryptocrawler_mc_calibration_v1 IS
  'Terminal-settlement Monte Carlo calibration history. Schema is migration-owned; runtime only reads/writes samples.';
COMMENT ON TABLE private.cryptocrawler_kraken_nonce_state IS
  'Distributed Kraken API nonce state. Schema is migration-owned so private CEX requests perform no DDL.';
