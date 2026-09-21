-- Durable, inspectable coordination for Pantheon report work.
-- Runtime code never creates these objects; deploy this migration administratively.

CREATE TABLE IF NOT EXISTS public.pantheon_job_leases (
  report_id uuid PRIMARY KEY,
  lease_owner text NOT NULL,
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pantheon_job_leases_expiry_idx
  ON public.pantheon_job_leases (lease_expires_at);

CREATE TABLE IF NOT EXISTS public.pantheon_frontier_items (
  work_key text PRIMARY KEY,
  report_id uuid NOT NULL,
  category_index smallint NOT NULL CHECK (category_index BETWEEN 0 AND 29),
  category_label text NOT NULL,
  canonical_url text NOT NULL,
  source_domain text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  transport text NOT NULL CHECK (transport IN ('direct-http', 'browser', 'search-provider', 'specialized-adapter', 'archive')),
  capability text NOT NULL,
  required_capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'retryable', 'leased', 'retrieving', 'retrieved', 'accepted',
    'rejected', 'blocked', 'rate_limited', 'dead', 'timed_out',
    'no_evidence', 'not_applicable'
  )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  deadline_at timestamptz,
  http_status integer,
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  crawler text,
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, category_index, canonical_url)
);

CREATE INDEX IF NOT EXISTS pantheon_frontier_claim_idx
  ON public.pantheon_frontier_items (report_id, category_index, priority DESC, created_at)
  WHERE state IN ('pending', 'retryable', 'rate_limited', 'timed_out');

CREATE INDEX IF NOT EXISTS pantheon_frontier_lease_expiry_idx
  ON public.pantheon_frontier_items (lease_expires_at)
  WHERE lease_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS pantheon_frontier_domain_idx
  ON public.pantheon_frontier_items (source_domain, state, updated_at);

CREATE TABLE IF NOT EXISTS public.pantheon_frontier_outcomes (
  outcome_id text PRIMARY KEY,
  work_key text NOT NULL REFERENCES public.pantheon_frontier_items(work_key) ON DELETE CASCADE,
  report_id uuid NOT NULL,
  category_index smallint NOT NULL CHECK (category_index BETWEEN 0 AND 29),
  canonical_url text NOT NULL,
  capability text NOT NULL,
  outcome_state text NOT NULL,
  http_status integer,
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  crawler text,
  failure_reason text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pantheon_frontier_outcomes_report_idx
  ON public.pantheon_frontier_outcomes (report_id, category_index, recorded_at);

CREATE INDEX IF NOT EXISTS pantheon_frontier_outcomes_work_idx
  ON public.pantheon_frontier_outcomes (work_key, recorded_at);

CREATE TABLE IF NOT EXISTS public.pantheon_domain_policy (
  source_domain text PRIMARY KEY,
  next_allowed_at timestamptz NOT NULL DEFAULT now(),
  circuit_open_until timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  latency_ewma_ms numeric(12, 2) NOT NULL DEFAULT 0,
  last_status integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pantheon_domain_leases (
  source_domain text NOT NULL REFERENCES public.pantheon_domain_policy(source_domain) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 2),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_domain, slot)
);

CREATE INDEX IF NOT EXISTS pantheon_domain_leases_expiry_idx
  ON public.pantheon_domain_leases (lease_expires_at)
  WHERE lease_token IS NOT NULL;

ALTER TABLE public.pantheon_job_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantheon_frontier_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantheon_frontier_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantheon_domain_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantheon_domain_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pantheon_job_leases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pantheon_frontier_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pantheon_frontier_outcomes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pantheon_domain_policy FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pantheon_domain_leases FROM PUBLIC, anon, authenticated;
