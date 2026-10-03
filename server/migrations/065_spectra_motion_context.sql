CREATE TABLE IF NOT EXISTS public.spectra_motion_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  session_id text NOT NULL,
  provider text,
  source_id text,
  observed_at timestamptz NOT NULL,
  latitude double precision NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude double precision NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  radius_meters double precision NOT NULL DEFAULT 250 CHECK (radius_meters >= 0),
  confidence double precision NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  vehicle_count integer CHECK (vehicle_count IS NULL OR vehicle_count >= 0),
  average_vehicle_speed_mps double precision CHECK (
    average_vehicle_speed_mps IS NULL OR
    (average_vehicle_speed_mps >= 0 AND average_vehicle_speed_mps <= 100)
  ),
  dominant_heading_degrees double precision CHECK (
    dominant_heading_degrees IS NULL OR
    (dominant_heading_degrees >= 0 AND dominant_heading_degrees < 360)
  ),
  congestion_ratio double precision CHECK (
    congestion_ratio IS NULL OR
    (congestion_ratio >= 0 AND congestion_ratio <= 1)
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spectra_motion_context_session_time_idx
  ON public.spectra_motion_context (session_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS spectra_motion_context_user_time_idx
  ON public.spectra_motion_context (user_id, observed_at DESC);

ALTER TABLE public.spectra_motion_context ENABLE ROW LEVEL SECURITY;
