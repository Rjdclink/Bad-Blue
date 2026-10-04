CREATE TABLE IF NOT EXISTS public.spectra_acquisition_control (
  user_id text NOT NULL,
  session_id text NOT NULL,
  stopped_at timestamptz,
  stop_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS spectra_acquisition_control_updated_idx
  ON public.spectra_acquisition_control (updated_at DESC);

REVOKE ALL ON TABLE public.spectra_acquisition_control
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spectra_acquisition_control
TO service_role;
