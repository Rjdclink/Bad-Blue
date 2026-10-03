REVOKE ALL ON TABLE
  public.spectra_investigations,
  public.spectra_clues,
  public.spectra_telemetry_events,
  public.spectra_location_observations
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.spectra_investigations,
  public.spectra_clues,
  public.spectra_telemetry_events,
  public.spectra_location_observations
TO service_role;
