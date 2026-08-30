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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_resource_leases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_mc_calibration_v1 TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_kraken_nonce_state TO service_role;

COMMENT ON TABLE public.cryptocrawler_resource_leases IS
  'Distributed CryptoCrawler execution resource leases. Schema is migration-owned so live trade admission performs no DDL.';
COMMENT ON TABLE public.cryptocrawler_mc_calibration_v1 IS
  'Terminal-settlement Monte Carlo calibration history. Schema is migration-owned; runtime only reads/writes samples.';
COMMENT ON TABLE private.cryptocrawler_kraken_nonce_state IS
  'Distributed Kraken API nonce state. Schema is migration-owned so private CEX requests perform no DDL.';
