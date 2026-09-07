-- Durable, leakage-safe Kalshi probability calibration evidence on Overflow.
-- Predictions are written before resolution; settlement labels are attached only
-- after the market becomes terminal. Raw market probability remains advisory
-- until the model/evaluation rows satisfy the application authority gates.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cryptocrawler_kalshi_probability_observations (
  observation_id text PRIMARY KEY,
  ticker text NOT NULL,
  event_ticker text NOT NULL,
  asset text,
  category text NOT NULL,
  liquidity_regime text NOT NULL,
  rules_fingerprint text NOT NULL,
  implied_probability numeric NOT NULL CHECK (implied_probability >= 0 AND implied_probability <= 1),
  observed_at timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  resolved_label smallint CHECK (resolved_label IN (0,1)),
  resolved_at timestamptz,
  resolution_source text,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kalshi_probability_resolution_pair CHECK (
    (resolved_label IS NULL AND resolved_at IS NULL)
    OR (resolved_label IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS cryptocrawler_kalshi_probability_unresolved_idx
  ON private.cryptocrawler_kalshi_probability_observations (cutoff_at, observed_at)
  WHERE resolved_label IS NULL;

CREATE INDEX IF NOT EXISTS cryptocrawler_kalshi_probability_resolved_idx
  ON private.cryptocrawler_kalshi_probability_observations (resolved_at DESC, observed_at DESC)
  WHERE resolved_label IS NOT NULL;

CREATE INDEX IF NOT EXISTS cryptocrawler_kalshi_probability_group_idx
  ON private.cryptocrawler_kalshi_probability_observations (asset, category, liquidity_regime, resolved_at DESC)
  WHERE resolved_label IS NOT NULL;

-- One correlated event/rules surface per observation instant is enough training
-- evidence. This prevents multiple synonymous market rows from multiplying the
-- statistical weight of the same event definition.
CREATE UNIQUE INDEX IF NOT EXISTS cryptocrawler_kalshi_probability_event_rules_observed_idx
  ON private.cryptocrawler_kalshi_probability_observations (event_ticker, rules_fingerprint, observed_at);

CREATE TABLE IF NOT EXISTS private.cryptocrawler_kalshi_probability_models (
  model_key text PRIMARY KEY,
  asset text,
  category text NOT NULL,
  liquidity_regime text NOT NULL,
  sample_count integer NOT NULL,
  holdout_count integer NOT NULL,
  raw_brier_score numeric,
  calibrated_brier_score numeric,
  raw_log_loss numeric,
  calibrated_log_loss numeric,
  recent_brier_score numeric,
  prior_brier_score numeric,
  drift_detected boolean NOT NULL DEFAULT false,
  authority_enabled boolean NOT NULL DEFAULT false,
  model jsonb NOT NULL,
  trained_through timestamptz,
  evaluated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.cryptocrawler_kalshi_probability_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.cryptocrawler_kalshi_probability_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cryptocrawler_kalshi_probability_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.cryptocrawler_kalshi_probability_models FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_kalshi_probability_observations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.cryptocrawler_kalshi_probability_models TO service_role;

COMMENT ON TABLE private.cryptocrawler_kalshi_probability_observations IS
  'Overflow-owned Kalshi prediction observations. Labels are attached only after public terminal settlement evidence; no future information is available at observation time.';
COMMENT ON TABLE private.cryptocrawler_kalshi_probability_models IS
  'Evaluated Kalshi calibration models with out-of-sample Brier/log-loss, confidence/drift gates and explicit authority_enabled truth.';