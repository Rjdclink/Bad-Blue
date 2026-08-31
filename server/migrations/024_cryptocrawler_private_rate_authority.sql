-- Cluster-wide private API pacing state for limits defined at account/User-ID scope.
-- Runtime code verifies this table and fails closed when distributed pacing is unavailable.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_private_rate_state (
  authority_key text PRIMARY KEY,
  next_allowed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cryptocrawler_private_rate_state_updated_idx
  ON private.cryptocrawler_private_rate_state (updated_at DESC);

ALTER TABLE private.cryptocrawler_private_rate_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.cryptocrawler_private_rate_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_private_rate_state TO service_role;

COMMENT ON TABLE private.cryptocrawler_private_rate_state IS
  'Cluster-wide pacing state for private exchange endpoints whose published rate limit is account/User-ID scoped. Runtime performs no DDL.';
