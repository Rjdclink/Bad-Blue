CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.spectra_investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  subject_label text NOT NULL,
  subject_key text NOT NULL,
  clues jsonb NOT NULL DEFAULT '[]'::jsonb,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','complete','paused','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spectra_investigations_user_updated_idx
  ON public.spectra_investigations (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS spectra_investigations_subject_idx
  ON public.spectra_investigations (user_id, subject_key);

CREATE TABLE IF NOT EXISTS public.spectra_clues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL
    REFERENCES public.spectra_investigations(id) ON DELETE CASCADE,
  clue_type text NOT NULL,
  raw_value text NOT NULL,
  normalized_value text NOT NULL,
  confidence double precision NOT NULL DEFAULT 0.25
    CHECK (confidence >= 0 AND confidence <= 1),
  evidence_count integer NOT NULL DEFAULT 1 CHECK (evidence_count >= 1),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (investigation_id, clue_type, normalized_value)
);

CREATE INDEX IF NOT EXISTS spectra_clues_investigation_idx
  ON public.spectra_clues (investigation_id, confidence DESC);

CREATE TABLE IF NOT EXISTS public.spectra_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL
    REFERENCES public.spectra_investigations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  source_type text NOT NULL,
  provider text,
  evidence_class text NOT NULL
    CHECK (evidence_class IN (
      'CURRENT_OBSERVATION',
      'RECENT_OBSERVATION',
      'HISTORICAL_LOCATION',
      'LOCATION_CANDIDATE',
      'INFERRED_LOCATION',
      'INTERPOLATED_LOCATION',
      'PREDICTED_LOCATION'
    )),
  latitude double precision NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude double precision NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  altitude double precision,
  accuracy_meters double precision CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  correlation_group text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_observation jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_fingerprint text NOT NULL,
  geom extensions.geography(Point, 4326)
    GENERATED ALWAYS AS (
      extensions.ST_SetSRID(
        extensions.ST_MakePoint(longitude, latitude),
        4326
      )::extensions.geography
    ) STORED,
  UNIQUE (investigation_id, evidence_fingerprint)
);

CREATE INDEX IF NOT EXISTS spectra_location_observations_investigation_time_idx
  ON public.spectra_location_observations (investigation_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS spectra_location_observations_user_time_idx
  ON public.spectra_location_observations (user_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS spectra_location_observations_geom_gist
  ON public.spectra_location_observations USING GIST (geom);

ALTER TABLE public.spectra_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectra_clues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spectra_location_observations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime
    ADD TABLE public.spectra_location_observations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime
    ADD TABLE public.spectra_clues;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
