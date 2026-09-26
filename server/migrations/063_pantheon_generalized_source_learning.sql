-- Generalized Pantheon source intelligence learning.
-- Extends the existing discovery-learning table without creating a parallel brain.
ALTER TABLE public.pantheon_discovery_learning
  ADD COLUMN IF NOT EXISTS objective_pattern text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS evidence_confidence double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_yield integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS pantheon_discovery_learning_general_rank_idx
  ON public.pantheon_discovery_learning
  (host, successes DESC, failures ASC, evidence_yield DESC, evidence_confidence DESC, updated_at DESC);

ALTER TABLE public.pantheon_discovery_learning ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pantheon_discovery_learning FROM PUBLIC;
