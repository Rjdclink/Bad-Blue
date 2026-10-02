CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.spectra_investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  subject_label text,
  session_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  clues jsonb NOT NULL DEFAULT '[]'::jsonb,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS spectra_investigations_session_idx
  ON public.spectra_investigations (session_id);
CREATE INDEX IF NOT EXISTS spectra_investigations_user_updated_idx
  ON public.spectra_investigations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.spectra_clues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES public.spectra_investigations(id) ON DELETE CASCADE,
  clue_type text NOT NULL,
  raw_value text NOT NULL,
  normalized_value text NOT NULL,
  confidence double precision NOT NULL DEFAULT 0.25 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_count integer NOT NULL DEFAULT 1 CHECK (evidence_count >= 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, clue_type, normalized_value)
);

CREATE INDEX IF NOT EXISTS spectra_clues_investigation_idx
  ON public.spectra_clues (investigation_id, confidence DESC, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.spectra_telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid REFERENCES public.spectra_investigations(id) ON DELETE CASCADE,
  user_id text,
  source_id text,
  provider text,
  subject_label text,
  session_id text NOT NULL,
  observed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_hash text NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (session_id, event_hash)
);

CREATE INDEX IF NOT EXISTS spectra_telemetry_events_session_time_idx
  ON public.spectra_telemetry_events (session_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.spectra_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid REFERENCES public.spectra_investigations(id) ON DELETE CASCADE,
  telemetry_event_id uuid REFERENCES public.spectra_telemetry_events(id) ON DELETE SET NULL,
  user_id text,
  session_id text NOT NULL,
  subject_label text,
  source_type text NOT NULL,
  provider text,
  latitude double precision NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude double precision NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  altitude double precision,
  accuracy_meters double precision CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  observation_kind text NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  correlation_group text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_fingerprint text NOT NULL,
  geom extensions.geography(Point, 4326)
    GENERATED ALWAYS AS (
      extensions.ST_SetSRID(
        extensions.ST_MakePoint(longitude, latitude),
        4326
      )::extensions.geography
    ) STORED,
  UNIQUE (session_id, evidence_fingerprint)
);

CREATE INDEX IF NOT EXISTS spectra_location_observations_session_time_idx
  ON public.spectra_location_observations (session_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS spectra_location_observations_user_time_idx
  ON public.spectra_location_observations (user_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS spectra_location_observations_geom_gist
  ON public.spectra_location_observations USING GIST (geom);

ALTER TABLE public.spectra_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectra_clues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectra_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectra_location_observations ENABLE ROW LEVEL SECURITY;

DO $
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'spectra_location_observations'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.spectra_location_observations;
  END IF;
END
$;
