-- Secondary Rainbow profit-source metadata is migration-owned.
-- Runtime code records/reads rows only; it must never create or index this table.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_rainbow_profit_sources (
  event_id text PRIMARY KEY,
  execution_source text NOT NULL,
  strategy text NOT NULL,
  symbol text NOT NULL,
  chain text,
  venue_or_route text,
  venues jsonb NOT NULL DEFAULT '[]'::jsonb,
  assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  transaction_hash text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rainbow_profit_source_route
  ON private.cryptocrawler_rainbow_profit_sources(venue_or_route, symbol);

ALTER TABLE private.cryptocrawler_rainbow_profit_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_rainbow_profit_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_rainbow_profit_sources TO service_role;

COMMENT ON TABLE private.cryptocrawler_rainbow_profit_sources IS
  'Secondary source metadata for terminal-confirmed profitable CryptoCrawler settlements. Migration-owned; runtime performs no DDL.';
