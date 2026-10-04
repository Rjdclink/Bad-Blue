CREATE INDEX IF NOT EXISTS spectra_location_observations_user_session_time_id_idx
  ON public.spectra_location_observations (
    user_id,
    session_id,
    observed_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS spectra_telemetry_events_user_session_time_idx
  ON public.spectra_telemetry_events (
    user_id,
    session_id,
    observed_at DESC,
    id DESC
  );
