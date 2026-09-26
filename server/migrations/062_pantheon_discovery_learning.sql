-- Persistent adaptive discovery learning for Pantheon.
-- Safe to run repeatedly; runtime also fails open if this table is unavailable.

CREATE TABLE IF NOT EXISTS public.pantheon_discovery_learning (
  url text NOT NULL,
  host text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  jurisdiction text NOT NULL DEFAULT '',
  crawler text NOT NULL DEFAULT '',
  query_pattern text NOT NULL DEFAULT '',
  successes integer NOT NULL DEFAULT 0 CHECK (successes >= 0),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  avg_latency_ms integer NOT NULL DEFAULT 0 CHECK (avg_latency_ms >= 0),
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (url, category, jurisdiction, crawler)
);

CREATE INDEX IF NOT EXISTS pantheon_discovery_learning_rank_idx
  ON public.pantheon_discovery_learning
  (category, jurisdiction, successes DESC, failures ASC, updated_at DESC);

ALTER TABLE public.pantheon_discovery_learning ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pantheon_discovery_learning FROM PUBLIC;
