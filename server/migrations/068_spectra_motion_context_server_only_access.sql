REVOKE ALL ON TABLE public.spectra_motion_context
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spectra_motion_context
TO service_role;
