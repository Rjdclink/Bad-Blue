-- Public provider feed cache and tenant-owned acquisition snapshots. Applied by
-- the administrative schema step, never by an application request or poll tick.
CREATE TABLE IF NOT EXISTS public.spectra_public_feed_state (
  provider text PRIMARY KEY,
  endpoint text NOT NULL,
  refresh_interval_ms integer NOT NULL CHECK (refresh_interval_ms >= 60000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'ok', 'partial', 'failed', 'not_modified')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_full_fetch_at timestamptz,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_record_count integer NOT NULL DEFAULT 0 CHECK (last_record_count >= 0),
  etag text,
  last_modified text,
  error_code text,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);

CREATE TABLE IF NOT EXISTS public.spectra_public_evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES public.spectra_public_feed_state(provider),
  record_id text NOT NULL,
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  source_url text NOT NULL,
  title text NOT NULL,
  observed_at timestamptz,
  source_updated_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  geometry jsonb,
  raw_record jsonb NOT NULL,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  classification text NOT NULL DEFAULT 'public_geographic_context'
    CHECK (classification = 'public_geographic_context'),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  UNIQUE (provider, record_id, raw_sha256)
);
CREATE INDEX IF NOT EXISTS spectra_public_evidence_latest_idx
  ON public.spectra_public_evidence_records (provider, record_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS spectra_public_evidence_seen_idx
  ON public.spectra_public_evidence_records (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.spectra_acquisition_evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES public.spectra_investigations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  session_id text NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('retrieved_document', 'geographic_context')),
  provider text NOT NULL,
  source_url text,
  retrieved_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, record_type, provider, content_hash)
);
CREATE INDEX IF NOT EXISTS spectra_acquisition_evidence_session_idx
  ON public.spectra_acquisition_evidence_records (user_id, session_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS spectra_acquisition_evidence_investigation_idx
  ON public.spectra_acquisition_evidence_records (investigation_id);

ALTER TABLE public.spectra_public_feed_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectra_public_evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectra_acquisition_evidence_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spectra_public_feed_state,
  public.spectra_public_evidence_records, public.spectra_acquisition_evidence_records FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.spectra_public_feed_state, public.spectra_public_evidence_records, public.spectra_acquisition_evidence_records FROM %I', api_role);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spectra_public_feed_state,
      public.spectra_public_evidence_records, public.spectra_acquisition_evidence_records TO service_role;
  END IF;
END
$$;
