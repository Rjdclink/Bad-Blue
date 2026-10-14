-- Server-side registry joining an enrolled phone number to a stable deviceRef.
-- Authorization/consent workflow is deliberately outside SPECTRA; this table
-- contains only the operational enrollment needed for active telemetry routing.
CREATE TABLE IF NOT EXISTS public.spectra_enrolled_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'),
  device_ref text NOT NULL CHECK (length(device_ref) BETWEEN 1 AND 300),
  subject_label text,
  owntracks_user text,
  owntracks_device text,
  traccar_device_id bigint CHECK (traccar_device_id IS NULL OR traccar_device_id > 0),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone_e164),
  UNIQUE (user_id, device_ref)
);

CREATE INDEX IF NOT EXISTS spectra_enrolled_devices_phone_idx
  ON public.spectra_enrolled_devices (user_id, phone_e164)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS spectra_enrolled_devices_device_idx
  ON public.spectra_enrolled_devices (user_id, device_ref)
  WHERE active = true;

ALTER TABLE public.spectra_enrolled_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spectra_enrolled_devices FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.spectra_enrolled_devices FROM %I', api_role);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spectra_enrolled_devices TO service_role;
  END IF;
END
$$;
