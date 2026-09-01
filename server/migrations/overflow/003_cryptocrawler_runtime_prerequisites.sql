-- CryptoCrawler Overflow runtime prerequisites.
-- This project is an internal server-side runtime authority surface. It mirrors
-- the durable CryptoCrawler state required by execution/governance/settlement,
-- but it intentionally does not install the terminal sweeper cron job.

CREATE SCHEMA IF NOT EXISTS private;

-- Historical deployments already contain this relation on Primary, while the
-- numbered payout migration extends it. Define the base relation explicitly on
-- Overflow so the payout/treasury migration chain is self-contained.
CREATE TABLE IF NOT EXISTS private.cryptocrawler_rainbow_profit_events (
  event_id text PRIMARY KEY,
  opportunity_id text,
  realized_profit_usd numeric NOT NULL CHECK (realized_profit_usd > 0),
  payout_target_usd numeric,
  retained_target_usd numeric,
  payout_operating_cost_usd numeric NOT NULL DEFAULT 0 CHECK (payout_operating_cost_usd >= 0),
  status text NOT NULL DEFAULT 'queued',
  destination_hash text NOT NULL,
  client_id text,
  asset text,
  chain text,
  payout_amount numeric,
  payout_fee numeric,
  withdrawal_id text,
  transaction_hash text,
  batch_id text,
  confirmed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_rainbow_profit_events_status
  ON private.cryptocrawler_rainbow_profit_events(status, created_at);

ALTER TABLE private.cryptocrawler_rainbow_profit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_rainbow_profit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_rainbow_profit_events TO service_role;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_overflow_runtime_meta (
  system_key text PRIMARY KEY,
  schema_version integer NOT NULL,
  schema_ready boolean NOT NULL DEFAULT false,
  seed_complete boolean NOT NULL DEFAULT false,
  seeded_at timestamptz,
  verified_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.cryptocrawler_overflow_runtime_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_overflow_runtime_meta FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_overflow_runtime_meta TO service_role;

INSERT INTO private.cryptocrawler_overflow_runtime_meta(system_key, schema_version, schema_ready, seed_complete)
VALUES ('cryptocrawler', 1, false, false)
ON CONFLICT (system_key) DO UPDATE
SET schema_version = GREATEST(private.cryptocrawler_overflow_runtime_meta.schema_version, EXCLUDED.schema_version),
    updated_at = now();
