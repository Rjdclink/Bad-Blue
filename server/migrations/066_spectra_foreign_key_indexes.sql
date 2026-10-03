CREATE INDEX IF NOT EXISTS spectra_location_observations_investigation_idx
  ON public.spectra_location_observations (investigation_id);

CREATE INDEX IF NOT EXISTS spectra_location_observations_telemetry_event_idx
  ON public.spectra_location_observations (telemetry_event_id);

CREATE INDEX IF NOT EXISTS spectra_telemetry_events_investigation_idx
  ON public.spectra_telemetry_events (investigation_id);
